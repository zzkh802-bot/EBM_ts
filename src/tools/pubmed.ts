import { XMLParser } from "fast-xml-parser";
import { Agent, fetch as undiciFetch } from "undici";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";
import { parseDocumentBytes, type MineruResource } from "./mineru.js";
import { downloadOpenAccessPdf, resolveOpenAlexPdf } from "./openAlex.js";

const ncbiDispatcher = new Agent({ connect: { family: 4 } });
const defaultNcbiFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  undiciFetch(input as string | URL, { ...(init as Record<string, unknown>), dispatcher: ncbiDispatcher }) as unknown as Promise<Response>
) as typeof fetch;
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const IDCONV = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/api/v1/articles/";

export type PubMedError = {
  code: "invalid_input" | "identifier_not_found" | "ncbi_request_failed" | "invalid_ncbi_response";
  message: string;
  status?: number;
};

export type PubMedSearchResult =
  | { ok: true; pmids: string[]; relatedPmids: string[]; abstractCount: number; abstractArchives: SourceArchiveRecord[]; warnings: string[]; archive: SourceArchiveRecord }
  | { ok: false; error: PubMedError };

export type PubMedSimilarResult =
  | { ok: true; seedPmid: string; relatedPmids: string[]; abstractArchives: SourceArchiveRecord[]; archive: SourceArchiveRecord; warnings: string[] }
  | { ok: false; error: PubMedError };

export type PubMedReadResult =
  | {
      ok: true;
      pmid: string;
      pmcid?: string;
      fullText: boolean;
      fullTextSource: "pmc" | "openalex_mineru" | "abstract_only";
      archive: SourceArchiveRecord;
      warnings: string[];
    }
  | { ok: false; error: PubMedError };

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  email?: string;
  apiKey?: string;
  retries?: number;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
};

type ParsedArticle = {
  pmid: string;
  title: string;
  journal?: string;
  pmcid?: string;
  doi?: string;
  abstractParts: string[];
};

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
  return { code: "ncbi_request_failed", message: body || `NCBI returned HTTP ${response.status}`, status: response.status };
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

function parsePubmedArticles(xml: string): ParsedArticle[] {
  const withoutInlineFormatting = xml.replace(/<\/?(?:i|b|em|strong|sup|sub|u)(?:\s[^>]*)?>/gi, "");
  const parsed = xmlParser.parse(withoutInlineFormatting) as any;
  return asArray(parsed?.PubmedArticleSet?.PubmedArticle).map((article: any): ParsedArticle => {
    const citation = article?.MedlineCitation ?? {};
    const articleData = citation.Article ?? {};
    const ids = asArray(article?.PubmedData?.ArticleIdList?.ArticleId);
    const idValue = (type: string) => {
      const found = ids.find((item: any) => item?.["@_IdType"] === type);
      const value = found ? textOf(found).trim() : "";
      return value || undefined;
    };
    const pmid = textOf(citation.PMID).trim() || idValue("pubmed") || "";
    const pmcid = idValue("pmc");
    const doi = idValue("doi");
    const abstractParts = asArray(articleData.Abstract?.AbstractText).map((part: any) => {
      const value = textOf(part).trim();
      const label = part && typeof part === "object" && typeof part["@_Label"] === "string" ? part["@_Label"] : undefined;
      return label && value ? `**${label}:** ${value}` : value;
    }).filter(Boolean);
    return {
      pmid,
      title: textOf(articleData.ArticleTitle).trim() || `PubMed ${pmid}`,
      ...(textOf(articleData.Journal?.Title).trim() ? { journal: textOf(articleData.Journal.Title).trim() } : {}),
      ...(pmcid ? { pmcid } : {}),
      ...(doi ? { doi } : {}),
      abstractParts,
    };
  }).filter((article) => /^\d+$/.test(article.pmid));
}

async function fetchPubmedArticles(
  pmids: string[],
  fetcher: typeof fetch,
  timeoutMs: number,
  retries: number,
  options: FetchOptions,
): Promise<ParsedArticle[]> {
  if (!pmids.length) return [];
  const url = new URL(`${EUTILS}/efetch.fcgi`);
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmids.join(","));
  url.searchParams.set("retmode", "xml");
  addNcbiIdentity(url, options);
  const response = await fetchTimed(fetcher, url, timeoutMs, retries, options.signal);
  const failure = await requireOk(response);
  if (failure) throw Object.assign(new Error(failure.message), { pubmedError: failure });
  return parsePubmedArticles(await response.text());
}

async function fetchRelated(
  pmids: string[],
  fetcher: typeof fetch,
  timeoutMs: number,
  retries: number,
  options: FetchOptions,
  limit: number,
): Promise<{ pmids: string[]; summaries: Record<string, any> }> {
  if (!pmids.length || limit <= 0) return { pmids: [], summaries: {} };
  const linkUrl = new URL(`${EUTILS}/elink.fcgi`);
  linkUrl.searchParams.set("dbfrom", "pubmed");
  linkUrl.searchParams.set("db", "pubmed");
  linkUrl.searchParams.set("id", pmids.join(","));
  linkUrl.searchParams.set("linkname", "pubmed_pubmed");
  linkUrl.searchParams.set("retmode", "json");
  addNcbiIdentity(linkUrl, options);
  const response = await fetchTimed(fetcher, linkUrl, timeoutMs, retries, options.signal);
  const failure = await requireOk(response);
  if (failure) throw new Error(failure.message);
  const payload = await response.json() as { linksets?: Array<{ linksetdbs?: Array<{ links?: unknown }> }> };
  const original = new Set(pmids);
  const related: string[] = [];
  for (const linkset of payload.linksets ?? []) {
    for (const database of linkset.linksetdbs ?? []) {
      for (const id of Array.isArray(database.links) ? database.links : []) {
        const value = String(id);
        if (/^\d+$/.test(value) && !original.has(value) && !related.includes(value)) related.push(value);
        if (related.length >= limit) break;
      }
      if (related.length >= limit) break;
    }
    if (related.length >= limit) break;
  }
  if (!related.length) return { pmids: [], summaries: {} };
  const summaryUrl = new URL(`${EUTILS}/esummary.fcgi`);
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("id", related.join(","));
  addNcbiIdentity(summaryUrl, options);
  const summaryResponse = await fetchTimed(fetcher, summaryUrl, timeoutMs, retries, options.signal);
  const summaryFailure = await requireOk(summaryResponse);
  if (summaryFailure) throw new Error(summaryFailure.message);
  const summaryPayload = await summaryResponse.json() as { result?: Record<string, any> };
  return { pmids: related, summaries: summaryPayload.result ?? {} };
}

function renderSearch(
  query: string,
  pmids: string[],
  articles: ParsedArticle[],
  related: { pmids: string[]; summaries: Record<string, any> },
  warnings: string[],
  abstractSources: Map<string, string>,
): string {
  const byPmid = new Map(articles.map((article) => [article.pmid, article]));
  const lines = [
    `# PubMed search: ${query}`,
    "",
    `Status: ${pmids.length ? "completed" : "no_results"}`,
    `Results: ${pmids.length}`,
    ...(pmids.length ? [] : ["", "No PubMed records matched this query."]),
    "",
  ];
  if (pmids.length) {
    lines.push("## Result index", "", "Complete abstracts appear later in this file. Use the separate `sources/read/` path for evidence.", "");
    pmids.forEach((pmid, index) => {
      const article = byPmid.get(pmid);
      const abstractSource = abstractSources.get(pmid);
      lines.push(`- ${index + 1}. PMID ${pmid}: ${article?.title ?? "PubMed record"}${abstractSource ? ` — abstract source: ${abstractSource}` : " — no complete abstract archived"}`);
    });
    lines.push("");
  }
  if (related.pmids.length) {
    lines.push("## Similar article hints", "", "Discovery hints only; call `pubmed_read` or run a targeted search before using one as evidence.", "");
    related.pmids.forEach((pmid) => {
      const item = related.summaries[pmid] ?? {};
      const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Related PubMed record";
      const metadata = [
        typeof item.source === "string" && item.source.trim() ? `Journal: ${item.source.trim()}` : undefined,
        typeof item.pubdate === "string" && item.pubdate.trim() ? `Date: ${item.pubdate.trim()}` : undefined,
      ].filter(Boolean).join("; ");
      lines.push(`- PMID ${pmid}: ${title}${metadata ? ` (${metadata})` : ""}. Continue with \`pubmed_read(identifier=\"PMID: ${pmid}\")\`.`);
    });
    lines.push("");
  }
  if (warnings.length) lines.push("## Retrieval notes", "", ...warnings.map((warning) => `- ${warning}`), "");
  if (pmids.length) lines.push("## Retrieved abstracts", "");
  pmids.forEach((pmid, index) => {
    const article = byPmid.get(pmid);
    lines.push(`### ${index + 1}. ${article?.title ?? `PMID ${pmid}`}`, "", `PMID: ${pmid}`, "Source status: PubMed abstract");
    const abstractSource = abstractSources.get(pmid);
    if (abstractSource) lines.push(`Citation-capable abstract source: ${abstractSource}`, "Evidence provenance: primary_abstract");
    if (article?.pmcid) lines.push(`PMCID: ${article.pmcid}`);
    if (article?.doi) lines.push(`DOI: ${article.doi}`);
    if (article?.journal) lines.push(`Journal: ${article.journal}`);
    lines.push("", "#### Abstract", "", ...(article?.abstractParts.length ? article.abstractParts : ["No abstract available from PubMed."]), "");
  });
  return lines.join("\n");
}

export async function similarPubMed(input: {
  sessionDir: string;
  pmid: string;
  maxResults?: number;
} & FetchOptions): Promise<PubMedSimilarResult> {
  const seedPmid = input.pmid.trim().replace(/^PMID\s*:\s*/i, "");
  if (!/^\d+$/.test(seedPmid)) return { ok: false, error: { code: "invalid_input", message: "A numeric PMID is required" } };
  const fetcher = input.fetcher ?? defaultNcbiFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 90_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  const options = { ...input, signal: operationSignal };
  try {
    const related = await fetchRelated([seedPmid], fetcher, timeoutMs, retries, options, Math.min(Math.max(input.maxResults ?? 5, 1), 10));
    const topPmids = related.pmids.slice(0, Math.min(Math.max(input.maxResults ?? 5, 1), 10));
    const articles = await fetchPubmedArticles(topPmids, fetcher, timeoutMs, retries, options);
    const abstractArchives = await Promise.all(articles.filter((article) => article.abstractParts.length > 0).map((article) => archiveSource({
      sessionDir: input.sessionDir,
      kind: "read",
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
      title: article.title,
      content: renderAbstractOnly(article),
    })));
    const abstractSources = new Map(articles.filter((article) => article.abstractParts.length > 0).map((article, index) => [article.pmid, abstractArchives[index]!.path]));
    const content = renderSearch(`similar to PMID ${seedPmid}`, topPmids, articles, { pmids: [], summaries: {} }, [], abstractSources);
    return {
      ok: true,
      seedPmid,
      relatedPmids: topPmids,
      abstractArchives,
      warnings: [],
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "search",
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${seedPmid}/`,
        title: `similar to PMID ${seedPmid}`,
        content,
      }),
    };
  } catch (error) {
    return { ok: false, error: unknownError(error) };
  }
}

export async function searchPubMed(input: {
  sessionDir: string;
  query: string;
  maxResults?: number;
  includeSimilar?: boolean;
  maxSimilar?: number;
} & FetchOptions): Promise<PubMedSearchResult> {
  if (!input.query.trim()) return { ok: false, error: { code: "invalid_input", message: "PubMed query is required" } };
  const fetcher = input.fetcher ?? defaultNcbiFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 90_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  const options = { ...input, signal: operationSignal };
  try {
    const searchUrl = new URL(`${EUTILS}/esearch.fcgi`);
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", String(Math.min(Math.max(input.maxResults ?? 10, 1), 50)));
    searchUrl.searchParams.set("term", input.query);
    searchUrl.searchParams.set("sort", "relevance");
    addNcbiIdentity(searchUrl, options);
    const searchResponse = await fetchTimed(fetcher, searchUrl, timeoutMs, retries, operationSignal);
    const searchFailure = await requireOk(searchResponse);
    if (searchFailure) return { ok: false, error: searchFailure };
    const searchPayload = await searchResponse.json() as { esearchresult?: { idlist?: unknown } };
    if (!Array.isArray(searchPayload.esearchresult?.idlist)) {
      return { ok: false, error: { code: "invalid_ncbi_response", message: "NCBI esearch response has no idlist" } };
    }
    const pmids = searchPayload.esearchresult.idlist.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
    const articles = await fetchPubmedArticles(pmids, fetcher, timeoutMs, retries, options);
    const warnings: string[] = [];
    let related: { pmids: string[]; summaries: Record<string, any> } = { pmids: [], summaries: {} };
    if (input.includeSimilar === true) {
      try {
        related = await fetchRelated(pmids, fetcher, timeoutMs, retries, options, Math.min(Math.max(input.maxSimilar ?? 5, 0), 10));
      } catch (error) {
        warnings.push(`Optional similar-article lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const abstractArchives = await Promise.all(articles.filter((article) => article.abstractParts.length > 0).map((article) => archiveSource({
      sessionDir: input.sessionDir,
      kind: "read",
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
      title: article.title,
      content: renderAbstractOnly(article),
    })));
    const abstractSources = new Map(articles.filter((article) => article.abstractParts.length > 0).map((article, index) => [article.pmid, abstractArchives[index]!.path]));
    const content = renderSearch(input.query, pmids, articles, related, warnings, abstractSources);
    return {
      ok: true,
      pmids,
      relatedPmids: related.pmids,
      abstractCount: abstractArchives.length,
      abstractArchives,
      warnings,
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "search",
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(input.query)}`,
        title: input.query,
        content,
      }),
    };
  } catch (error) {
    const embedded = error && typeof error === "object" && "pubmedError" in error ? (error as any).pubmedError as PubMedError : undefined;
    return { ok: false, error: embedded ?? unknownError(error) };
  }
}

async function resolvePmid(identifier: string, fetcher: typeof fetch, timeoutMs: number, retries: number, options: FetchOptions): Promise<string | undefined> {
  if (/^\d+$/.test(identifier)) return identifier;
  const url = new URL(IDCONV);
  url.searchParams.set("format", "json");
  url.searchParams.set("ids", identifier);
  if (options.email) url.searchParams.set("email", options.email);
  const response = await fetchTimed(fetcher, url, timeoutMs, retries, options.signal);
  if (!response.ok) return undefined;
  const payload = await response.json() as { records?: Array<{ pmid?: unknown }> };
  const pmid = payload.records?.[0]?.pmid;
  return typeof pmid === "string" || typeof pmid === "number" ? String(pmid) : undefined;
}

function collectPmcSections(body: unknown, depth = 2): string[] {
  const lines: string[] = [];
  for (const section of asArray((body as any)?.sec)) {
    const title = textOf((section as any)?.title).trim();
    if (title) lines.push(`${"#".repeat(Math.min(depth, 6))} ${title}`, "");
    for (const paragraph of asArray((section as any)?.p)) {
      const text = textOf(paragraph).trim();
      if (text) lines.push(text, "");
    }
    lines.push(...collectPmcSections(section, depth + 1));
  }
  return lines;
}

function renderFullText(article: ParsedArticle, pmcXml: string): string {
  const parsed = xmlParser.parse(pmcXml) as any;
  const root = parsed?.article ?? parsed?.pmc?.article ?? parsed?.["pmc-articleset"]?.article;
  if (!root?.body) throw new Error("PMC response has no article body");
  const body = collectPmcSections(root.body);
  if (!body.some((line) => line && !line.startsWith("#"))) throw new Error("PMC article body has no readable paragraphs");
  return [
    `# ${article.title}`,
    "",
    `PMID: ${article.pmid}`,
    ...(article.pmcid ? [`PMCID: ${article.pmcid}`] : []),
    ...(article.doi ? [`DOI: ${article.doi}`] : []),
    ...(article.journal ? [`Journal: ${article.journal}`] : []),
    "Source status: PMC full text",
    "",
    "## Abstract",
    "",
    ...(article.abstractParts.length ? article.abstractParts : ["No abstract available from PubMed."]),
    "",
    "## Full Text",
    "",
    ...body,
  ].join("\n");
}

function renderOpenAlexFullText(article: ParsedArticle, markdown: string, sourceName?: string): string {
  return [
    `# ${article.title}`,
    "",
    `PMID: ${article.pmid}`,
    ...(article.doi ? [`DOI: ${article.doi}`] : []),
    ...(article.journal ? [`Journal: ${article.journal}`] : []),
    "Source status: OA full text discovered through OpenAlex and parsed by MinerU",
    ...(sourceName ? [`OA location: ${sourceName}`] : []),
    "",
    "## Full Text",
    "",
    markdown,
  ].join("\n");
}

function renderAbstractOnly(article: ParsedArticle): string {
  return [
    `# ${article.title}`,
    "",
    `PMID: ${article.pmid}`,
    ...(article.pmcid ? [`PMCID: ${article.pmcid}`] : []),
    ...(article.doi ? [`DOI: ${article.doi}`] : []),
    ...(article.journal ? [`Journal: ${article.journal}`] : []),
    "Source status: PubMed abstract only; full text unavailable",
    "",
    "## Abstract",
    "",
    ...(article.abstractParts.length ? article.abstractParts : ["No abstract available from PubMed."]),
    "",
  ].join("\n");
}

export async function readPubMed(input: {
  sessionDir: string;
  identifier: string;
  mineruApiToken?: string;
  mineruBaseUrl?: string;
  openAlexTimeoutMs?: number;
  oaDownloadTimeoutMs?: number;
  resolveHost?: (host: string) => Promise<string[]>;
} & FetchOptions): Promise<PubMedReadResult> {
  const identifier = input.identifier.trim().replace(/^(?:PMID|PMCID|DOI)\s*:\s*/i, "");
  if (!identifier) return { ok: false, error: { code: "invalid_input", message: "PMID, PMCID, or DOI is required" } };
  const fetcher = input.fetcher ?? defaultNcbiFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 240_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  const options = { ...input, signal: operationSignal };
  try {
    const pmid = await resolvePmid(identifier, fetcher, timeoutMs, retries, options);
    if (!pmid) return { ok: false, error: { code: "identifier_not_found", message: `No PMID found for ${identifier}` } };
    const articles = await fetchPubmedArticles([pmid], fetcher, timeoutMs, retries, options);
    const article = articles[0];
    if (!article) return { ok: false, error: { code: "invalid_ncbi_response", message: "NCBI efetch response has no article" } };

    let content = renderAbstractOnly(article);
    let fullText = false;
    let fullTextSource: "pmc" | "openalex_mineru" | "abstract_only" = "abstract_only";
    let sourceUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
    let parsedMineruResources: MineruResource[] | undefined;
    const warnings: string[] = [];
    if (article.pmcid) {
      const pmcUrl = new URL(`${EUTILS}/efetch.fcgi`);
      pmcUrl.searchParams.set("db", "pmc");
      pmcUrl.searchParams.set("id", article.pmcid.replace(/^PMC/i, ""));
      pmcUrl.searchParams.set("retmode", "xml");
      addNcbiIdentity(pmcUrl, options);
      try {
        const pmcResponse = await fetchTimed(fetcher, pmcUrl, timeoutMs, retries, operationSignal);
        const pmcFailure = await requireOk(pmcResponse);
        if (pmcFailure) throw new Error(pmcFailure.message);
        content = renderFullText(article, await pmcResponse.text());
        fullText = true;
        fullTextSource = "pmc";
        sourceUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${article.pmcid}/`;
      } catch (error) {
        warnings.push(`PMC full text retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!fullText && input.mineruApiToken) {
      try {
        const oa = await resolveOpenAlexPdf({
          pmid,
          fetcher,
          ...(input.openAlexTimeoutMs === undefined ? {} : { timeoutMs: input.openAlexTimeoutMs }),
          signal: operationSignal,
        });
        if (oa) {
          const downloaded = await downloadOpenAccessPdf({
            url: oa.pdfUrl,
            fetcher,
            ...(input.resolveHost ? { resolveHost: input.resolveHost } : {}),
            ...(input.oaDownloadTimeoutMs === undefined ? {} : { timeoutMs: input.oaDownloadTimeoutMs }),
            signal: operationSignal,
          });
          const parsed = await parseDocumentBytes({
            bytes: downloaded.bytes,
            fileName: `pubmed-${pmid}.pdf`,
            apiToken: input.mineruApiToken,
            fetcher,
            ...(input.mineruBaseUrl ? { baseUrl: input.mineruBaseUrl } : {}),
            requestTimeoutMs: 25_000,
            signal: operationSignal,
          });
          content = renderOpenAlexFullText(article, parsed.content, oa.sourceName);
          parsedMineruResources = parsed.resources;
          fullText = true;
          fullTextSource = "openalex_mineru";
          sourceUrl = downloaded.finalUrl;
        } else {
          warnings.push("OpenAlex did not provide a direct OA PDF for this PMID.");
        }
      } catch (error) {
        warnings.push(`Bounded OpenAlex/MinerU fallback failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!fullText && !article.pmcid) {
      warnings.push("No PMCID is linked to this PubMed record; only the abstract is archived.");
    }
    return {
      ok: true,
      pmid,
      ...(article.pmcid ? { pmcid: article.pmcid } : {}),
      fullText,
      fullTextSource,
      warnings,
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        sourceUrl,
        title: article.title,
        content,
        ...(fullTextSource === "openalex_mineru" && parsedMineruResources ? { resources: parsedMineruResources } : {}),
      }),
    };
  } catch (error) {
    const embedded = error && typeof error === "object" && "pubmedError" in error ? (error as any).pubmedError as PubMedError : undefined;
    return { ok: false, error: embedded ?? unknownError(error) };
  }
}
