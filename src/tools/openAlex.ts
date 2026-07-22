import { lookup } from "node:dns/promises";
import { isPrivateAddress, validateOutboundUrl } from "./urlSafety.js";

export type OpenAlexPdfLocation = {
  workId: string;
  doi?: string;
  pdfUrl: string;
  landingPageUrl?: string;
  sourceName?: string;
};

export type OpenAccessPdfDownload = { bytes: Uint8Array; finalUrl: string };

type OpenAlexLocation = {
  is_oa?: unknown;
  pdf_url?: unknown;
  landing_page_url?: unknown;
  source?: { display_name?: unknown; type?: unknown };
};

async function defaultResolveHost(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((entry) => entry.address);
}

async function assertPublicResolvedUrl(url: URL, resolveHost: (host: string) => Promise<string[]>): Promise<void> {
  const addresses = await resolveHost(url.hostname);
  if (!addresses.length) throw new Error(`PDF host did not resolve: ${url.hostname}`);
  if (addresses.some(isPrivateAddress)) throw new Error(`PDF URL resolves to a private address: ${url.hostname}`);
}

export async function downloadPdf(input: {
  url: string;
  fetcher?: typeof fetch;
  resolveHost?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}): Promise<OpenAccessPdfDownload> {
  const fetcher = input.fetcher ?? fetch;
  const resolveHost = input.resolveHost ?? defaultResolveHost;
  const maxBytes = input.maxBytes ?? 50 * 1024 * 1024;
  const maxRedirects = input.maxRedirects ?? 5;
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 25_000;
  const timer = setTimeout(() => controller.abort(new Error(`PDF download timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    let current = input.url;
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const checked = validateOutboundUrl(current);
      if (!checked.ok) throw new Error(`unsafe PDF URL: ${checked.reason}`);
      await assertPublicResolvedUrl(checked.url, resolveHost);
      const response = await fetcher(checked.url.toString(), { signal: controller.signal, redirect: "manual", headers: { "User-Agent": "EBM-Agent-TS/0.1", Accept: "application/pdf" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`OA PDF redirect ${response.status} has no Location header`);
        current = new URL(location, checked.url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`PDF returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(`PDF exceeds ${maxBytes} byte limit`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error(`PDF exceeds ${maxBytes} byte limit`);
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("URL did not return a PDF document");
      return { bytes, finalUrl: checked.url.toString() };
    }
    throw new Error(`PDF exceeded ${maxRedirects} redirects`);
  } finally {
    clearTimeout(timer);
  }
}

export const downloadOpenAccessPdf = downloadPdf;

export async function resolveOpenAlexPdf(input: {
  pmid: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<OpenAlexPdfLocation | undefined> {
  if (!/^\d+$/.test(input.pmid)) throw new Error("OpenAlex resolution requires a numeric PMID");
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 5_000;
  const timer = setTimeout(() => controller.abort(new Error(`OpenAlex request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await (input.fetcher ?? fetch)(`https://api.openalex.org/works/${encodeURIComponent(`pmid:${input.pmid}`)}`, {
      signal: controller.signal,
      headers: { "User-Agent": "EBM-Agent-TS/0.1" },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`OpenAlex returned HTTP ${response.status}`);
    const payload = await response.json() as { id?: unknown; doi?: unknown; locations?: unknown };
    if (typeof payload.id !== "string" || !Array.isArray(payload.locations)) throw new Error("OpenAlex response is malformed");
    const locations = payload.locations as OpenAlexLocation[];
    const candidates = locations.filter((location) => location.is_oa === true && typeof location.pdf_url === "string");
    const selected = candidates.find((location) => location.source?.type === "repository") ?? candidates[0];
    if (!selected || typeof selected.pdf_url !== "string") return undefined;
    const safe = validateOutboundUrl(selected.pdf_url);
    if (!safe.ok) throw new Error(`OpenAlex returned an unsafe PDF URL: ${safe.reason}`);
    return {
      workId: payload.id,
      ...(typeof payload.doi === "string" ? { doi: payload.doi } : {}),
      pdfUrl: safe.url.toString(),
      ...(typeof selected.landing_page_url === "string" ? { landingPageUrl: selected.landing_page_url } : {}),
      ...(typeof selected.source?.display_name === "string" ? { sourceName: selected.source.display_name } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
