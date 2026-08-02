import { XMLParser } from "fast-xml-parser";
import { Agent, fetch as undiciFetch } from "undici";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";
import { preprocessExternalContent } from "./markdown.js";

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
      fullTextSource: "pmc" | "abstract_only";
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
  includeContext?: boolean;
};

type PubMedCommentLink = { refType: string; pmid?: string; citation?: string; note?: string };

type ParsedArticle = {
  pmid: string;
  title: string;
  authors: string[];
  journal?: string;
  pmcid?: string;
  doi?: string;
  abstractParts: string[];
  publicationTypes: string[];
  commentLinks: PubMedCommentLink[];
};

type PubMedLinkedSummary = { pmid: string; title: string; journal?: string; pubdate?: string };

type PubMedContext = {
  similar: PubMedLinkedSummary[];
  citedBy: PubMedLinkedSummary[];
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
    const authors = asArray(articleData.AuthorList?.Author).map((author: any) => {
      const collective = textOf(author?.CollectiveName).trim();
      if (collective) return collective;
      const foreName = textOf(author?.ForeName).trim();
      const lastName = textOf(author?.LastName).trim();
      return [foreName, lastName].filter(Boolean).join(" ");
    }).filter(Boolean);
    const publicationTypes = asArray(articleData.PublicationTypeList?.PublicationType).map((item) => textOf(item).trim()).filter(Boolean);
    const commentLinks = asArray(articleData.CommentsCorrectionsList?.CommentsCorrections).map((item: any): PubMedCommentLink | undefined => {
      const refType = typeof item?.["@_RefType"] === "string" ? item["@_RefType"] : "linked record";
      const linkedPmid = textOf(item?.PMID).trim();
      const citation = textOf(item?.RefSource).trim();
      const note = textOf(item?.Note).trim();
      return linkedPmid || citation || note ? { refType, ...(linkedPmid ? { pmid: linkedPmid } : {}), ...(citation ? { citation } : {}), ...(note ? { note } : {}) } : undefined;
    }).filter((item): item is PubMedCommentLink => !!item);
    return {
      pmid,
      title: textOf(articleData.ArticleTitle).trim() || `PubMed ${pmid}`,
      authors,
      ...(textOf(articleData.Journal?.Title).trim() ? { journal: textOf(articleData.Journal.Title).trim() } : {}),
      ...(pmcid ? { pmcid } : {}),
      ...(doi ? { doi } : {}),
      abstractParts,
      publicationTypes,
      commentLinks,
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

async function fetchLinkedPubmed(
  pmids: string[],
  linkname: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  retries: number,
  options: FetchOptions,
  limit: number,
): Promise<{ pmids: string[]; summaries: Record<string, any>; items: PubMedLinkedSummary[] }> {
  if (!pmids.length || limit <= 0) return { pmids: [], summaries: {}, items: [] };
  const linkUrl = new URL(`${EUTILS}/elink.fcgi`);
  linkUrl.searchParams.set("dbfrom", "pubmed");
  linkUrl.searchParams.set("db", "pubmed");
  linkUrl.searchParams.set("id", pmids.join(","));
  linkUrl.searchParams.set("linkname", linkname);
  linkUrl.searchParams.set("retmode", "json");
  addNcbiIdentity(linkUrl, options);
  const response = await fetchTimed(fetcher, linkUrl, timeoutMs, retries, options.signal);
  const failure = await requireOk(response);
  if (failure) throw new Error(failure.message);
  const payload = await response.json() as { linksets?: Array<{ linksetdbs?: Array<{ links?: unknown }> }> };
  const original = new Set(pmids);
  const linked: string[] = [];
  for (const linkset of payload.linksets ?? []) {
    for (const database of linkset.linksetdbs ?? []) {
      for (const id of Array.isArray(database.links) ? database.links : []) {
        const value = String(id);
        if (/^\d+$/.test(value) && !original.has(value) && !linked.includes(value)) linked.push(value);
        if (linked.length >= limit) break;
      }
      if (linked.length >= limit) break;
    }
    if (linked.length >= limit) break;
  }
  if (!linked.length) return { pmids: [], summaries: {}, items: [] };
  const summaryUrl = new URL(`${EUTILS}/esummary.fcgi`);
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("id", linked.join(","));
  addNcbiIdentity(summaryUrl, options);
  const summaryResponse = await fetchTimed(fetcher, summaryUrl, timeoutMs, retries, options.signal);
  const summaryFailure = await requireOk(summaryResponse);
  if (summaryFailure) throw new Error(summaryFailure.message);
  const summaryPayload = await summaryResponse.json() as { result?: Record<string, any> };
  const summaries = summaryPayload.result ?? {};
  const items = linked.map((pmid) => {
    const item = summaries[pmid] ?? {};
    return {
      pmid,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `PMID ${pmid}`,
      ...(typeof item.source === "string" && item.source.trim() ? { journal: item.source.trim() } : {}),
      ...(typeof item.pubdate === "string" && item.pubdate.trim() ? { pubdate: item.pubdate.trim() } : {}),
    };
  });
  return { pmids: linked, summaries, items };
}

async function fetchRelated(
  pmids: string[],
  fetcher: typeof fetch,
  timeoutMs: number,
  retries: number,
  options: FetchOptions,
  limit: number,
): Promise<{ pmids: string[]; summaries: Record<string, any> }> {
  return fetchLinkedPubmed(pmids, "pubmed_pubmed", fetcher, timeoutMs, retries, options, limit);
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
    if (article?.authors.length) lines.push(`Authors: ${article.authors.slice(0, 12).join(", ")}${article.authors.length > 12 ? ", et al." : ""}`);
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
  return renderPubmedFullTextMarkdown(article, body, "PMC full text");
}

function renderPubmedFullTextMarkdown(article: ParsedArticle, body: string[], sourceStatus: string): string {
  return [
    `# ${article.title}`,
    "",
    `PMID: ${article.pmid}`,
    ...(article.pmcid ? [`PMCID: ${article.pmcid}`] : []),
    ...(article.doi ? [`DOI: ${article.doi}`] : []),
    ...(article.authors.length ? [`Authors: ${article.authors.slice(0, 12).join(", ")}${article.authors.length > 12 ? ", et al." : ""}`] : []),
    ...(article.journal ? [`Journal: ${article.journal}`] : []),
    `Source status: ${sourceStatus}`,
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

function extractBalancedSection(html: string, startIndex: number): string | undefined {
  const tag = /<\/?section\b[^>]*>/gi;
  tag.lastIndex = startIndex;
  let depth = 0;
  let contentStart = -1;
  for (;;) {
    const match = tag.exec(html);
    if (!match) return undefined;
    const isClose = match[0].startsWith("</");
    if (!isClose) {
      depth += 1;
      if (contentStart < 0) contentStart = tag.lastIndex;
    } else {
      depth -= 1;
      if (depth === 0 && contentStart >= 0) return html.slice(contentStart, match.index);
    }
  }
}

function htmlBodyToMarkdown(fragment: string): string[] {
  return preprocessExternalContent(fragment, { format: "html" }).split("\n");
}

function renderPmcHtmlFullText(article: ParsedArticle, html: string): string {
  const marker = '<section class="body main-article-body"';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("PMC HTML response has no main article body");
  const bodySection = extractBalancedSection(html, start);
  if (!bodySection) throw new Error("PMC HTML article body is not balanced");
  const body = htmlBodyToMarkdown(bodySection);
  if (!body.some((line) => line && !line.startsWith("#"))) throw new Error("PMC HTML article body has no readable paragraphs");
  return renderPubmedFullTextMarkdown(article, body, "PMC full text (HTML page)");
}

function renderLinkedItems(items: PubMedLinkedSummary[]): string[] {
  return items.map((item) => {
    const meta = [item.journal ? `Journal: ${item.journal}` : undefined, item.pubdate ? `Date: ${item.pubdate}` : undefined].filter(Boolean).join("; ");
    return `- PMID ${item.pmid}: ${item.title}${meta ? ` (${meta})` : ""}`;
  });
}

function renderPubMedContext(article: ParsedArticle, context?: PubMedContext, warnings: string[] = []): string[] {
  const lines = [
    "## PubMed context",
    "",
    "Navigation/context only. Linked records below are not citation evidence unless separately read and archived.",
    "",
    `Access hint: ${article.pmcid ? `Free PMC linked (${article.pmcid})` : "No PMCID linked"}`,
    ...(article.doi ? [`DOI: ${article.doi}`] : []),
    ...(article.publicationTypes.length ? [`Publication types: ${article.publicationTypes.join("; ")}`] : []),
    ...(warnings.length ? [`Retrieval notes: ${warnings.join(" | ")}`] : []),
    "",
  ];
  if (article.commentLinks.length) {
    lines.push("### Comments / updates", ...article.commentLinks.slice(0, 5).map((item) => `- ${item.refType}${item.pmid ? ` PMID ${item.pmid}` : ""}${item.citation ? `: ${item.citation}` : ""}${item.note ? ` (${item.note})` : ""}`), "");
  }
  if (context?.similar.length) lines.push("### Similar articles (top 5)", ...renderLinkedItems(context.similar.slice(0, 5)), "");
  if (context?.citedBy.length) lines.push("### Cited by (sample)", ...renderLinkedItems(context.citedBy.slice(0, 3)), "");
  return lines;
}

function renderAbstractOnly(article: ParsedArticle, context?: PubMedContext, warnings: string[] = []): string {
  return [
    `# ${article.title}`,
    "",
    `PMID: ${article.pmid}`,
    ...(article.pmcid ? [`PMCID: ${article.pmcid}`] : []),
    ...(article.doi ? [`DOI: ${article.doi}`] : []),
    ...(article.authors.length ? [`Authors: ${article.authors.slice(0, 12).join(", ")}${article.authors.length > 12 ? ", et al." : ""}`] : []),
    ...(article.journal ? [`Journal: ${article.journal}`] : []),
    "Source status: PubMed abstract only; full text unavailable",
    "",
    "## Abstract",
    "",
    ...(article.abstractParts.length ? article.abstractParts : ["No abstract available from PubMed."]),
    "",
    ...renderPubMedContext(article, context, warnings),
  ].join("\n");
}

export async function readPubMed(input: {
  sessionDir: string;
  identifier: string;
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
    let fullTextSource: "pmc" | "abstract_only" = "abstract_only";
    let sourceUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
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
        try {
          const htmlUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${article.pmcid}/`;
          const htmlResponse = await fetcher(htmlUrl, {
            signal: operationSignal,
            headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
          });
          const htmlFailure = await requireOk(htmlResponse);
          if (htmlFailure) throw new Error(htmlFailure.message);
          content = renderPmcHtmlFullText(article, await htmlResponse.text());
          fullText = true;
          fullTextSource = "pmc";
          sourceUrl = htmlUrl;
          warnings.push(`PMC XML full text unavailable (${error instanceof Error ? error.message : String(error)}); used PMC HTML page.`);
        } catch (htmlError) {
          warnings.push(`PMC full text retrieval failed: ${error instanceof Error ? error.message : String(error)}; PMC HTML fallback failed: ${htmlError instanceof Error ? htmlError.message : String(htmlError)}`);
        }
      }
    }

    if (!fullText && !article.pmcid) {
      warnings.push("No PMCID is linked to this PubMed record; only the abstract is archived.");
    }
    if (!fullText) {
      let context: PubMedContext | undefined;
      if (input.includeContext === true) {
        try {
          const contextTimeoutMs = Math.min(timeoutMs, 10_000);
          const similar = await fetchLinkedPubmed([pmid], "pubmed_pubmed", fetcher, contextTimeoutMs, 0, options, 5);
          if (!options.apiKey) await sleep(400);
          const citedBy = await fetchLinkedPubmed([pmid], "pubmed_pubmed_citedin", fetcher, contextTimeoutMs, 0, options, 3);
          context = { similar: similar.items, citedBy: citedBy.items };
        } catch (error) {
          warnings.push(`PubMed context link lookup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      content = renderAbstractOnly(article, context, warnings);
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
      }),
    };
  } catch (error) {
    const embedded = error && typeof error === "object" && "pubmedError" in error ? (error as any).pubmedError as PubMedError : undefined;
    return { ok: false, error: embedded ?? unknownError(error) };
  }
}
