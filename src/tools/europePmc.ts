import { XMLParser } from "fast-xml-parser";
import { Agent, fetch as undiciFetch } from "undici";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";
import { cleanExternalText, normalizeMarkdown } from "./markdown.js";

const europePmcDispatcher = new Agent({ connect: { family: 4 } });
const defaultEuropePmcFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  undiciFetch(input as string | URL, { ...(init as Record<string, unknown>), dispatcher: europePmcDispatcher }) as unknown as Promise<Response>
) as typeof fetch;
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

const EUROPE_PMC_REST = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export type EuropePmcError = {
  code: "invalid_input" | "identifier_not_found" | "europepmc_request_failed" | "invalid_europepmc_response";
  message: string;
  status?: number;
};

export type EuropePmcSearchResult =
  | { ok: true; pmids: string[]; pmcids: string[]; abstractCount: number; abstractArchives: SourceArchiveRecord[]; fullTextAvailable: number; warnings: string[]; archive: SourceArchiveRecord }
  | { ok: false; error: EuropePmcError };

export type EuropePmcReadResult =
  | {
      ok: true;
      pmcid: string;
      pmid?: string;
      fullText: boolean;
      fullTextSource: "europepmc_oa" | "abstract_only";
      archive: SourceArchiveRecord;
      warnings: string[];
    }
  | { ok: false; error: EuropePmcError };

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
};

type EuropePmcRecord = {
  id?: unknown;
  pmcid?: unknown;
  pmid?: unknown;
  doi?: unknown;
  title?: unknown;
  authorString?: unknown;
  journalTitle?: unknown;
  pubYear?: unknown;
  isOpenAccess?: unknown;
  inPMC?: unknown;
  abstractText?: unknown;
  fullTextUrlList?: unknown;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTimed(fetcher: typeof fetch, url: URL, timeoutMs: number, retries: number, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, headers: { "User-Agent": "EBM-Agent-TS/0.1" } });
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
    await sleep(350 * (2 ** attemptIndex));
  }
  throw lastError instanceof Error ? lastError : new Error("Europe PMC request failed after retries");
}

async function requireOk(response: Response): Promise<EuropePmcError | undefined> {
  if (response.ok) return undefined;
  const body = (await response.text()).trim().slice(0, 300);
  return { code: "europepmc_request_failed", message: body || `Europe PMC returned HTTP ${response.status}`, status: response.status };
}

function unknownError(error: unknown): EuropePmcError {
  if (!(error instanceof Error)) return { code: "europepmc_request_failed", message: String(error) };
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
    const causeMessage = "message" in cause && typeof cause.message === "string" ? cause.message : undefined;
    const detail = [code, causeMessage].filter(Boolean).join(": ");
    if (detail) return { code: "europepmc_request_failed", message: `${error.message} (${detail})` };
  }
  return { code: "europepmc_request_failed", message: error.message };
}

function asString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return Array.isArray(value) ? value.map(asString).filter(Boolean).join(" ") : "";
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

function abstractTextToMarkdown(value: string): string {
  const paragraphTags = value.replace(/<\s*\/?\s*(?:p|h[1-6])\b[^>]*>/gi, "\n");
  return normalizeMarkdown(cleanExternalText(paragraphTags.replace(/<\/?[^>]+>/gi, "")).replace(/\n{3,}/g, "\n\n").trim());
}

function parseRecord(item: unknown): EuropePmcRecord {
  const record = (item ?? {}) as Record<string, unknown>;
  const result: EuropePmcRecord = {};
  const assign = (key: keyof EuropePmcRecord, sourceKey: string): void => {
    const value = record[sourceKey];
    if (value !== undefined && value !== null) (result as Record<string, unknown>)[key] = value;
  };
  assign("id", "id");
  assign("pmcid", "pmcid");
  assign("pmid", "pmid");
  assign("doi", "doi");
  assign("title", "title");
  assign("authorString", "authorString");
  assign("journalTitle", "journalTitle");
  assign("pubYear", "pubYear");
  assign("isOpenAccess", "isOpenAccess");
  assign("inPMC", "inPMC");
  assign("abstractText", "abstractText");
  assign("fullTextUrlList", "fullTextUrlList");
  return result;
}

function renderAbstractOnly(record: EuropePmcRecord, warnings: string[] = [], fullTextNote = "full text unavailable"): string {
  const abstract = abstractTextToMarkdown(asString(record.abstractText));
  return [
    `# ${asString(record.title) || `Europe PMC ${asString(record.id) || "record"}`}`,
    "",
    ...(asString(record.pmid) ? [`PMID: ${asString(record.pmid)}`] : []),
    ...(asString(record.pmcid) ? [`PMCID: ${asString(record.pmcid)}`] : []),
    ...(asString(record.doi) ? [`DOI: ${asString(record.doi)}`] : []),
    ...(asString(record.authorString) ? [`Authors: ${asString(record.authorString)}`] : []),
    ...(asString(record.journalTitle) ? [`Journal: ${asString(record.journalTitle)}`] : []),
    ...(asString(record.pubYear) ? [`Publication year: ${asString(record.pubYear)}`] : []),
    "Source status: Europe PMC abstract" + (fullTextNote ? `; ${fullTextNote}` : ""),
    "",
    "## Abstract",
    "",
    ...(abstract ? [abstract] : ["No abstract available from Europe PMC."]),
    "",
    ...(warnings.length ? ["## Retrieval notes", "", ...warnings.map((warning) => `- ${warning}`), ""] : []),
  ].join("\n");
}

function collectPmcSections(body: unknown, depth = 2): string[] {
  const lines: string[] = [];
  for (const section of Array.isArray((body as any)?.sec) ? (body as any).sec : (body as any)?.sec ? [(body as any).sec] : []) {
    const title = textOf(section?.title).trim();
    if (title) lines.push(`${"#".repeat(Math.min(depth, 6))} ${title}`, "");
    for (const paragraph of Array.isArray(section?.p) ? section.p : section?.p ? [section.p] : []) {
      const text = textOf(paragraph).trim();
      if (text) lines.push(text, "");
    }
    lines.push(...collectPmcSections(section, depth + 1));
  }
  return lines;
}

function renderFullText(record: EuropePmcRecord, pmcXml: string): string {
  const parsed = xmlParser.parse(pmcXml) as any;
  const root = parsed?.article ?? parsed?.pmc?.article ?? parsed?.["pmc-articleset"]?.article;
  if (!root?.body) throw new Error("Europe PMC response has no article body");
  const body = collectPmcSections(root.body);
  if (!body.some((line) => line && !line.startsWith("#"))) throw new Error("Europe PMC article body has no readable paragraphs");
  const abstract = abstractTextToMarkdown(asString(record.abstractText));
  return [
    `# ${asString(record.title) || `Europe PMC ${asString(record.id) || "record"}`}`,
    "",
    ...(asString(record.pmid) ? [`PMID: ${asString(record.pmid)}`] : []),
    ...(asString(record.pmcid) ? [`PMCID: ${asString(record.pmcid)}`] : []),
    ...(asString(record.doi) ? [`DOI: ${asString(record.doi)}`] : []),
    ...(asString(record.authorString) ? [`Authors: ${asString(record.authorString)}`] : []),
    ...(asString(record.journalTitle) ? [`Journal: ${asString(record.journalTitle)}`] : []),
    ...(asString(record.pubYear) ? [`Publication year: ${asString(record.pubYear)}`] : []),
    "Source status: Europe PMC full text (Open Access)",
    "",
    "## Abstract",
    "",
    ...(abstract ? [abstract] : ["No abstract available from Europe PMC."]),
    "",
    "## Full Text",
    "",
    ...body,
  ].join("\n");
}

export async function searchEuropePmc(input: {
  sessionDir: string;
  query: string;
  maxResults?: number;
} & FetchOptions): Promise<EuropePmcSearchResult> {
  if (!input.query.trim()) return { ok: false, error: { code: "invalid_input", message: "Europe PMC query is required" } };
  const fetcher = input.fetcher ?? defaultEuropePmcFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 120_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  try {
    const searchUrl = new URL(`${EUROPE_PMC_REST}/search`);
    searchUrl.searchParams.set("query", input.query);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("resultType", "core");
    searchUrl.searchParams.set("pageSize", String(Math.min(Math.max(input.maxResults ?? 10, 1), 50)));
    const response = await fetchTimed(fetcher, searchUrl, timeoutMs, retries, operationSignal);
    const failure = await requireOk(response);
    if (failure) return { ok: false, error: failure };
    const payload = await response.json() as { hitCount?: unknown; resultList?: { result?: unknown } };
    if (!Array.isArray(payload.resultList?.result)) {
      return { ok: false, error: { code: "invalid_europepmc_response", message: "Europe PMC search response has no result list" } };
    }
    const records = payload.resultList.result.map(parseRecord);
    const warnings: string[] = [];
    const withAbstracts = records.filter((record) => asString(record.abstractText).trim().length > 0);
    const noAbstract = records.filter((record) => asString(record.abstractText).trim().length === 0);
    if (noAbstract.length) warnings.push(`${noAbstract.length} record(s) had no abstract text; only PMID metadata is listed.`);
    const abstractArchives = await Promise.all(withAbstracts.map((record) => archiveSource({
      sessionDir: input.sessionDir,
      kind: "read",
      sourceUrl: `https://europepmc.org/article/${asString(record.pmcid) ? `PMC/${asString(record.pmcid).replace(/^PMC/, "")}` : `MED/${asString(record.pmid)}`}`,
      title: asString(record.title) || `Europe PMC ${asString(record.id) ?? ""}`,
      content: renderAbstractOnly(record, [], asString(record.isOpenAccess) === "Y" || asString(record.inPMC) === "Y" ? "Open Access full text available; not archived" : undefined),
    })));
    const abstractSources = new Map(withAbstracts.map((record, index) => [asString(record.id), abstractArchives[index]!.path]));
    const fullTextAvailable = records.filter((record) => asString(record.isOpenAccess) === "Y" || asString(record.inPMC) === "Y").length;
    const lines = [
      `# Europe PMC search: ${input.query}`,
      "",
      `Status: ${records.length ? "completed" : "no_results"}`,
      `Results: ${asString(payload.hitCount) || records.length}`,
      ...(records.length ? [] : ["", "No Europe PMC records matched this query."]),
      "",
    ];
    if (records.length) {
      lines.push("## Result index", "", "Complete abstracts appear later in this file. Use the separate `sources/read/` path for evidence.", "");
      records.forEach((record, index) => {
        const abstractSource = abstractSources.get(asString(record.id));
        const access = [
          asString(record.pmcid) ? `PMCID ${asString(record.pmcid)}` : undefined,
          asString(record.isOpenAccess) === "Y" ? "Open Access full text available" : undefined,
          asString(record.inPMC) === "Y" ? "in PMC" : undefined,
        ].filter(Boolean);
        lines.push(`- ${index + 1}. ${asString(record.title) || "Europe PMC record"}${asString(record.pmid) ? ` (PMID ${asString(record.pmid)})` : ""}${access.length ? ` — ${access.join("; ")}` : ""}${abstractSource ? ` — abstract source: ${abstractSource}` : " — no complete abstract archived"}`);
      });
      lines.push("");
    }
    if (warnings.length) lines.push("## Retrieval notes", "", ...warnings.map((warning) => `- ${warning}`), "");
    if (records.length) lines.push("## Retrieved abstracts", "");
    withAbstracts.forEach((record, index) => {
      const abstract = abstractTextToMarkdown(asString(record.abstractText));
      lines.push(`### ${index + 1}. ${asString(record.title) || `Europe PMC ${asString(record.id) ?? ""}`}`, "", ...(asString(record.pmid) ? [`PMID: ${asString(record.pmid)}`] : []), ...(asString(record.pmcid) ? [`PMCID: ${asString(record.pmcid)}`] : []), ...(asString(record.doi) ? [`DOI: ${asString(record.doi)}`] : []), ...(asString(record.journalTitle) ? [`Journal: ${asString(record.journalTitle)}`] : []), "Source status: Europe PMC abstract", "");
      const abstractSource = abstractSources.get(asString(record.id));
      if (abstractSource) lines.push(`Citation-capable abstract source: ${abstractSource}`, "Evidence provenance: primary_abstract", "");
      lines.push("#### Abstract", "", ...(abstract ? [abstract] : ["No abstract available."]), "");
    });
    return {
      ok: true,
      pmids: records.map((record) => asString(record.pmid)).filter(Boolean),
      pmcids: records.map((record) => asString(record.pmcid)).filter(Boolean),
      abstractCount: abstractArchives.length,
      abstractArchives,
      fullTextAvailable,
      warnings,
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "search",
        sourceUrl: `https://europepmc.org/search?query=${encodeURIComponent(input.query)}`,
        title: input.query,
        content: lines.join("\n"),
      }),
    };
  } catch (error) {
    return { ok: false, error: unknownError(error) };
  }
}

export async function readEuropePmc(input: {
  sessionDir: string;
  identifier: string;
} & FetchOptions): Promise<EuropePmcReadResult> {
  const identifier = input.identifier.trim().replace(/^(?:PMID|PMCID|MED|PMC)\s*:\s*/i, "").replace(/^pmc/i, "PMC");
  if (!identifier) return { ok: false, error: { code: "invalid_input", message: "PMID, PMCID, or PMCID-prefixed identifier is required" } };
  const fetcher = input.fetcher ?? defaultEuropePmcFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 180_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  try {
    const lookupUrl = new URL(`${EUROPE_PMC_REST}/search`);
    lookupUrl.searchParams.set("query", /^PMC\d+$/i.test(identifier) ? `PMCID:${identifier}` : `EXT_ID:${identifier}`);
    lookupUrl.searchParams.set("format", "json");
    lookupUrl.searchParams.set("resultType", "core");
    lookupUrl.searchParams.set("pageSize", "3");
    const lookupResponse = await fetchTimed(fetcher, lookupUrl, timeoutMs, retries, operationSignal);
    const lookupFailure = await requireOk(lookupResponse);
    if (lookupFailure) throw Object.assign(new Error(lookupFailure.message), { europePmcError: lookupFailure });
    const payload = await lookupResponse.json() as { resultList?: { result?: unknown } };
    const record = parseRecord(Array.isArray(payload.resultList?.result) ? payload.resultList.result.find((item) => {
      const parsed = parseRecord(item);
      const lower = identifier.toLowerCase().replace(/^pmc/i, "");
      return asString(parsed.pmcid).toLowerCase().replace(/^pmc/i, "") === lower || asString(parsed.pmid) === identifier;
    }) ?? payload.resultList.result[0] : undefined);
    if (!record || !asString(record.pmid) && !asString(record.pmcid)) {
      return { ok: false, error: { code: "identifier_not_found", message: `No Europe PMC record found for ${identifier}` } };
    }
    const warnings: string[] = [];
    const pmcid = asString(record.pmcid);
    if (pmcid && (asString(record.isOpenAccess) === "Y" || asString(record.inPMC) === "Y")) {
      try {
        const fullTextUrl = new URL(`${EUROPE_PMC_REST}/${pmcid}/fullTextXML`);
        const fullTextResponse = await fetchTimed(fetcher, fullTextUrl, timeoutMs, retries, operationSignal);
        const fullTextFailure = await requireOk(fullTextResponse);
        if (fullTextFailure) throw new Error(fullTextFailure.message);
        const content = renderFullText(record, await fullTextResponse.text());
        return {
          ok: true,
          pmcid,
          ...(asString(record.pmid) ? { pmid: asString(record.pmid) } : {}),
          fullText: true,
          fullTextSource: "europepmc_oa",
          warnings,
          archive: await archiveSource({
            sessionDir: input.sessionDir,
            kind: "read",
            sourceUrl: `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/, "")}`,
            title: asString(record.title) || `Europe PMC ${pmcid}`,
            content,
          }),
        };
      } catch (error) {
        warnings.push(`Europe PMC full text retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (!pmcid) {
      warnings.push("No PMCID is linked to this record through Europe PMC; only the abstract is archived.");
    } else {
      warnings.push("The record is not Open Access in PMC; only the abstract is archived.");
    }
    const content = renderAbstractOnly(record, warnings);
    return {
      ok: true,
      pmcid: pmcid || `unknown-${asString(record.id) || identifier}`,
      ...(asString(record.pmid) ? { pmid: asString(record.pmid) } : {}),
      fullText: false,
      fullTextSource: "abstract_only",
      warnings,
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        sourceUrl: `https://europepmc.org/article/${asString(record.pmcid) ? `PMC/${asString(record.pmcid).replace(/^PMC/, "")}` : `MED/${asString(record.pmid) || asString(record.id)}`}`,
        title: asString(record.title) || `Europe PMC ${asString(record.id) || identifier}`,
        content,
      }),
    };
  } catch (error) {
    const embedded = error && typeof error === "object" && "europePmcError" in error ? (error as any).europePmcError as EuropePmcError : undefined;
    return { ok: false, error: embedded ?? unknownError(error) };
  }
}