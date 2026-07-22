import { XMLParser } from "fast-xml-parser";
import { Agent, fetch as undiciFetch } from "undici";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";

const ncbiDispatcher = new Agent({ connect: { family: 4 } });
const defaultNcbiFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  undiciFetch(input as string | URL, { ...(init as Record<string, unknown>), dispatcher: ncbiDispatcher }) as unknown as Promise<Response>
) as typeof fetch;

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const IDCONV = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/api/v1/articles/";

export type PubMedError = {
  code: "invalid_input" | "identifier_not_found" | "ncbi_request_failed" | "invalid_ncbi_response";
  message: string;
  status?: number;
};

export type PubMedSearchResult =
  | { ok: true; pmids: string[]; archive: SourceArchiveRecord }
  | { ok: false; error: PubMedError };

export type PubMedReadResult =
  | { ok: true; pmid: string; pmcid?: string; archive: SourceArchiveRecord; warnings: string[] }
  | { ok: false; error: PubMedError };

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  email?: string;
  apiKey?: string;
  retries?: number;
};

async function fetchTimed(fetcher: typeof fetch, url: URL, timeoutMs: number, retries: number): Promise<Response> {
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { signal: controller.signal, headers: { "User-Agent": "EBM-Agent-TS/0.1" } });
      if ((response.status === 429 || response.status >= 500) && attemptIndex < retries) {
        await response.body?.cancel();
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attemptIndex >= retries) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attemptIndex)));
  }
  throw lastError instanceof Error ? lastError : new Error("NCBI request failed after retries");
}

function addNcbiIdentity(url: URL, options: FetchOptions): void {
  url.searchParams.set("tool", "ebm_agent_ts");
  if (options.email) url.searchParams.set("email", options.email);
  if (options.apiKey) url.searchParams.set("api_key", options.apiKey);
}

async function requireOk(response: Response): Promise<PubMedError | undefined> {
  if (response.ok) return undefined;
  const body = (await response.text()).trim().slice(0, 300);
  return {
    code: "ncbi_request_failed",
    message: body || `NCBI returned HTTP ${response.status}`,
    status: response.status,
  };
}

function unknownError(error: unknown): PubMedError {
  if (!(error instanceof Error)) return { code: "ncbi_request_failed", message: String(error) };
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
    const causeMessage = "message" in cause && typeof cause.message === "string" ? cause.message : undefined;
    const detail = [code, causeMessage].filter(Boolean).join(": ");
    if (detail) return { code: "ncbi_request_failed", message: `${error.message} (${detail})` };
  }
  return { code: "ncbi_request_failed", message: error.message };
}

export async function searchPubMed(input: {
  sessionDir: string;
  query: string;
  maxResults?: number;
} & FetchOptions): Promise<PubMedSearchResult> {
  if (!input.query.trim()) return { ok: false, error: { code: "invalid_input", message: "PubMed query is required" } };
  const fetcher = input.fetcher ?? defaultNcbiFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  try {
    const searchUrl = new URL(`${EUTILS}/esearch.fcgi`);
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", String(Math.min(Math.max(input.maxResults ?? 10, 1), 50)));
    searchUrl.searchParams.set("term", input.query);
    addNcbiIdentity(searchUrl, input);
    const searchResponse = await fetchTimed(fetcher, searchUrl, timeoutMs, retries);
    const searchFailure = await requireOk(searchResponse);
    if (searchFailure) return { ok: false, error: searchFailure };
    const searchPayload = await searchResponse.json() as { esearchresult?: { idlist?: unknown } };
    if (!Array.isArray(searchPayload.esearchresult?.idlist)) {
      return { ok: false, error: { code: "invalid_ncbi_response", message: "NCBI esearch response has no idlist" } };
    }
    const pmids = searchPayload.esearchresult.idlist.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
    let summaries: Record<string, any> = {};
    if (pmids.length) {
      const summaryUrl = new URL(`${EUTILS}/esummary.fcgi`);
      summaryUrl.searchParams.set("db", "pubmed");
      summaryUrl.searchParams.set("retmode", "json");
      summaryUrl.searchParams.set("id", pmids.join(","));
      addNcbiIdentity(summaryUrl, input);
      const summaryResponse = await fetchTimed(fetcher, summaryUrl, timeoutMs, retries);
      const summaryFailure = await requireOk(summaryResponse);
      if (summaryFailure) return { ok: false, error: summaryFailure };
      const summaryPayload = await summaryResponse.json() as { result?: Record<string, any> };
      if (!summaryPayload.result) {
        return { ok: false, error: { code: "invalid_ncbi_response", message: "NCBI esummary response has no result" } };
      }
      summaries = summaryPayload.result;
    }
    const lines = [`# PubMed search: ${input.query}`, "", `Results: ${pmids.length}`, ""];
    pmids.forEach((pmid, index) => {
      const item = summaries[pmid] ?? {};
      lines.push(`## ${index + 1}. ${typeof item.title === "string" ? item.title : `PMID ${pmid}`}`, "", `PMID: ${pmid}`);
      if (typeof item.pubdate === "string") lines.push(`Published: ${item.pubdate}`);
      if (typeof item.source === "string") lines.push(`Journal: ${item.source}`);
      if (Array.isArray(item.authors)) {
        const authors = item.authors.map((author: any) => author?.name).filter((name: unknown): name is string => typeof name === "string");
        if (authors.length) lines.push(`Authors: ${authors.join(", ")}`);
      }
      lines.push("");
    });
    const publicUrl = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(input.query)}`;
    return {
      ok: true,
      pmids,
      archive: await archiveSource({ sessionDir: input.sessionDir, kind: "search", sourceUrl: publicUrl, title: input.query, content: lines.join("\n") }),
    };
  } catch (error) {
    return { ok: false, error: unknownError(error) };
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => textOf(child))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

async function resolvePmid(identifier: string, fetcher: typeof fetch, timeoutMs: number, retries: number, options: FetchOptions): Promise<string | undefined> {
  if (/^\d+$/.test(identifier)) return identifier;
  const url = new URL(IDCONV);
  url.searchParams.set("format", "json");
  url.searchParams.set("ids", identifier);
  if (options.email) url.searchParams.set("email", options.email);
  const response = await fetchTimed(fetcher, url, timeoutMs, retries);
  if (!response.ok) return undefined;
  const payload = await response.json() as { records?: Array<{ pmid?: unknown }> };
  const pmid = payload.records?.[0]?.pmid;
  return typeof pmid === "string" || typeof pmid === "number" ? String(pmid) : undefined;
}

export async function readPubMed(input: {
  sessionDir: string;
  identifier: string;
} & FetchOptions): Promise<PubMedReadResult> {
  const identifier = input.identifier.trim();
  if (!identifier) return { ok: false, error: { code: "invalid_input", message: "PMID, PMCID, or DOI is required" } };
  const fetcher = input.fetcher ?? defaultNcbiFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  try {
    const pmid = await resolvePmid(identifier, fetcher, timeoutMs, retries, input);
    if (!pmid) return { ok: false, error: { code: "identifier_not_found", message: `No PMID found for ${identifier}` } };
    const url = new URL(`${EUTILS}/efetch.fcgi`);
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("id", pmid);
    url.searchParams.set("retmode", "xml");
    addNcbiIdentity(url, input);
    const response = await fetchTimed(fetcher, url, timeoutMs, retries);
    const failure = await requireOk(response);
    if (failure) return { ok: false, error: failure };
    const xml = await response.text();
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true }).parse(xml) as any;
    const article = asArray(parsed?.PubmedArticleSet?.PubmedArticle)[0];
    if (!article) return { ok: false, error: { code: "invalid_ncbi_response", message: "NCBI efetch response has no article" } };
    const citation = article.MedlineCitation ?? {};
    const articleData = citation.Article ?? {};
    const ids = asArray(article.PubmedData?.ArticleIdList?.ArticleId);
    const idValue = (type: string) => {
      const found = ids.find((item: any) => item?.["@_IdType"] === type);
      return found ? textOf(found) : undefined;
    };
    const pmcid = idValue("pmc");
    const doi = idValue("doi");
    const abstractParts = asArray(articleData.Abstract?.AbstractText).map((part: any) => {
      const text = textOf(part);
      const label = part && typeof part === "object" && typeof part["@_Label"] === "string" ? part["@_Label"] : undefined;
      return label ? `**${label}:** ${text}` : text;
    }).filter(Boolean);
    const lines = [
      `# ${textOf(articleData.ArticleTitle) || `PubMed ${pmid}`}`,
      "",
      `PMID: ${pmid}`,
      ...(pmcid ? [`PMCID: ${pmcid}`] : []),
      ...(doi ? [`DOI: ${doi}`] : []),
      ...(textOf(articleData.Journal?.Title) ? [`Journal: ${textOf(articleData.Journal.Title)}`] : []),
      "",
      "## Abstract",
      "",
      ...(abstractParts.length ? abstractParts : ["No abstract available from PubMed."]),
      "",
    ];
    const warnings = pmcid ? ["PMC full text is identified but not yet appended; use web_read on the PMCID URL if full text is required."] : [];
    return {
      ok: true,
      pmid,
      ...(pmcid ? { pmcid } : {}),
      warnings,
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        title: textOf(articleData.ArticleTitle) || `PubMed ${pmid}`,
        content: lines.join("\n"),
      }),
    };
  } catch (error) {
    return { ok: false, error: unknownError(error) };
  }
}
