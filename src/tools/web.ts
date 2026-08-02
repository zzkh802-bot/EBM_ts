import { archiveSource, type SourceArchiveRecord } from "./archive.js";
import { parseDocumentBytes, parseDocumentUrl } from "./mineru.js";
import { downloadPdf, probePdfContentType } from "./openAlex.js";
import { estimatePdfPages, extractPdfPages, pdfFileName, pdfNavigationPreview } from "./pdf.js";
import { readFromSourceLibrary } from "./sourceLibrary.js";
import { jinaReaderUrl, validateOutboundUrl } from "./urlSafety.js";

export type NetworkAttempt = {
  provider: "mineru" | "jina" | "firecrawl" | "tavily";
  message: string;
  status?: number;
};

export type WebToolError = {
  code: "unsafe_url" | "missing_api_key" | "all_readers_failed" | "search_failed" | "pdf_too_large";
  message: string;
  attempts: NetworkAttempt[];
};

export type WebReadResult =
  | { ok: true; provider: "mineru" | "jina" | "firecrawl" | "library"; archive: SourceArchiveRecord }
  | { ok: false; error: WebToolError };

export type WebSearchCandidate = { title: string; url?: string; summary?: string; score?: number };

export type WebSearchResult =
  | { ok: true; provider: "tavily"; archive: SourceArchiveRecord; resultCount: number; candidates: WebSearchCandidate[] }
  | { ok: false; error: WebToolError };

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  signal?: AbortSignal;
};

function firstMarkdownTitle(markdown: string): string | undefined {
  const title = markdown.split("\n").map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim()).find(Boolean);
  return title || undefined;
}

function isAccessVerificationPage(markdown: string): boolean {
  const text = markdown.toLowerCase();
  const markers = [
    "title: just a moment",
    "requiring captcha",
    "captcha required",
    "performing security verification",
    "verifies you are not a bot",
    "verify you are human",
    "enable javascript and cookies to continue",
    "cf-chl-",
  ];
  const matches = markers.reduce((count, marker) => count + Number(text.includes(marker)), 0);
  return matches >= 2 || (markdown.length < 2_000 && matches >= 1);
}

function assertSourceContent(markdown: string): void {
  if (!markdown.trim()) throw new Error("empty Markdown response");
  if (isAccessVerificationPage(markdown)) {
    throw new Error("reader returned an access-verification page instead of source content");
  }
}

async function request(fetcher: typeof fetch, input: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function attempt(provider: NetworkAttempt["provider"], error: unknown, status?: number): NetworkAttempt {
  return {
    provider,
    message: error instanceof Error ? error.message : String(error),
    ...(status === undefined ? {} : { status }),
  };
}

async function responseFailure(provider: NetworkAttempt["provider"], response: Response): Promise<NetworkAttempt> {
  const body = (await response.text()).trim().slice(0, 500);
  return attempt(provider, body || `HTTP ${response.status}`, response.status);
}

export async function readWeb(input: {
  sessionDir: string;
  url: string;
  jinaApiKey?: string;
  firecrawlApiKey?: string;
  mineruApiToken?: string;
  mineruBaseUrl?: string;
  pdfDownloadTimeoutMs?: number;
  maxPdfPagesForMineru?: number;
  pdfPages?: string;
  sourceLibraryDir?: string;
  resolveHost?: (host: string) => Promise<string[]>;
} & FetchOptions): Promise<WebReadResult> {
  const safe = validateOutboundUrl(input.url);
  if (!safe.ok) {
    return { ok: false, error: { code: "unsafe_url", message: safe.reason, attempts: [] } };
  }
  const libraryArchive = await readFromSourceLibrary({
    sessionDir: input.sessionDir,
    ...(input.sourceLibraryDir ? { sourceLibraryDir: input.sourceLibraryDir } : {}),
    url: safe.url.toString(),
  });
  if (libraryArchive && !isAccessVerificationPage(libraryArchive.content)) {
    return { ok: true, provider: "library", archive: libraryArchive };
  }

  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 240_000);
  const signal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  const attempts: NetworkAttempt[] = [];
  let isDocument = /\.(?:pdf|docx?|pptx?|xlsx?|epub|mobi)(?:$|[?#&])/i.test(safe.url.toString());
  let isPdf = /\.pdf(?:$|[?#&])/i.test(safe.url.toString());
  if (!isDocument && input.mineruApiToken) {
    try {
      isPdf = await probePdfContentType({
        url: safe.url.toString(),
        fetcher,
        ...(input.resolveHost ? { resolveHost: input.resolveHost } : {}),
        timeoutMs: Math.min(timeoutMs, 5_000),
        signal,
      });
      isDocument = isPdf;
    } catch {
      // Type probing is optional; ordinary web readers remain available.
    }
  }

  if (isDocument && input.mineruApiToken) {
    if (isPdf && input.maxPdfPagesForMineru !== undefined) {
      try {
        const downloaded = await downloadPdf({
          url: safe.url.toString(),
          fetcher,
          ...(input.resolveHost ? { resolveHost: input.resolveHost } : {}),
          timeoutMs: input.pdfDownloadTimeoutMs ?? 25_000,
          signal,
        });
        const pageCount = await estimatePdfPages(downloaded.bytes);
        if (!input.pdfPages && pageCount !== undefined && pageCount > input.maxPdfPagesForMineru) {
          const navigation = await pdfNavigationPreview(downloaded.bytes);
          const message = [
            `PDF has ${pageCount} pages, above WEB_READ MinerU page limit ${input.maxPdfPagesForMineru}.`,
            "Automatic full parsing was skipped; no fallback reader was attempted for this oversized PDF.",
            "The outline/text below is a navigation preview only. It is not archived and is not citation-eligible; do not use it with evidence_add or cite it as evidence.",
            "Use web_read with pdf_pages (for example 3-8) for a focused page range, or ingest the full document into the local source library/MCP.",
            "",
            navigation,
          ].join("\n");
          return { ok: false, error: { code: "pdf_too_large", message, attempts: [attempt("mineru", new Error(message))] } };
        } else {
          const bytes = input.pdfPages ? await extractPdfPages(downloaded.bytes, input.pdfPages) : downloaded.bytes;
          const prefix = input.pdfPages ? `pages-${input.pdfPages.replace(/\s+/g, "")}-` : "";
          const parsed = await parseDocumentBytes({
            bytes,
            fileName: `${prefix}${pdfFileName(downloaded.finalUrl)}`,
            apiToken: input.mineruApiToken,
            fetcher,
            ...(input.mineruBaseUrl ? { baseUrl: input.mineruBaseUrl } : {}),
            requestTimeoutMs: timeoutMs,
            signal,
          });
          const title = firstMarkdownTitle(parsed.content);
          return {
            ok: true,
            provider: "mineru",
            archive: await archiveSource({
              sessionDir: input.sessionDir,
              kind: "read",
              sourceUrl: safe.url.toString(),
              ...(title ? { title } : {}),
              content: parsed.content,
              resources: parsed.resources,
            }),
          };
        }
      } catch (error) {
        attempts.push(attempt("mineru", new Error(`Premium PDF preflight/local parsing failed: ${error instanceof Error ? error.message : String(error)}`)));
      }
    } else {
      try {
        const parsed = await parseDocumentUrl({
          url: safe.url.toString(),
          apiToken: input.mineruApiToken,
          fetcher,
          ...(input.mineruBaseUrl ? { baseUrl: input.mineruBaseUrl } : {}),
          requestTimeoutMs: timeoutMs,
          signal,
        });
        const title = firstMarkdownTitle(parsed.content);
        return {
          ok: true,
          provider: "mineru",
          archive: await archiveSource({
            sessionDir: input.sessionDir,
            kind: "read",
            sourceUrl: safe.url.toString(),
            ...(title ? { title } : {}),
            content: parsed.content,
            resources: parsed.resources,
          }),
        };
      } catch (error) {
        attempts.push(attempt("mineru", new Error(`Premium URL parsing failed: ${error instanceof Error ? error.message : String(error)}`)));
      }

      if (isPdf) {
        try {
          const downloaded = await downloadPdf({
            url: safe.url.toString(),
            fetcher,
            ...(input.resolveHost ? { resolveHost: input.resolveHost } : {}),
            timeoutMs: input.pdfDownloadTimeoutMs ?? 25_000,
            signal,
          });
          const parsed = await parseDocumentBytes({
            bytes: downloaded.bytes,
            fileName: pdfFileName(downloaded.finalUrl),
            apiToken: input.mineruApiToken,
            fetcher,
            ...(input.mineruBaseUrl ? { baseUrl: input.mineruBaseUrl } : {}),
            requestTimeoutMs: timeoutMs,
            signal,
          });
          const title = firstMarkdownTitle(parsed.content);
          return {
            ok: true,
            provider: "mineru",
            archive: await archiveSource({
              sessionDir: input.sessionDir,
              kind: "read",
              sourceUrl: safe.url.toString(),
              ...(title ? { title } : {}),
              content: parsed.content,
              resources: parsed.resources,
            }),
          };
        } catch (error) {
          attempts.push(attempt("mineru", new Error(`Premium local-upload fallback failed: ${error instanceof Error ? error.message : String(error)}`)));
        }
      }
    }
  }

  try {
    const response = await request(fetcher, jinaReaderUrl(safe.url.toString()), {
      headers: {
        Accept: "text/markdown",
        ...(input.jinaApiKey ? { Authorization: `Bearer ${input.jinaApiKey}` } : {}),
      },
    }, timeoutMs, signal);
    if (!response.ok) {
      attempts.push(await responseFailure("jina", response));
    } else {
      const markdown = await response.text();
      assertSourceContent(markdown);
      return {
        ok: true,
        provider: "jina",
        archive: await archiveSource({
          sessionDir: input.sessionDir,
          kind: "read",
          sourceUrl: safe.url.toString(),
          content: markdown,
        }),
      };
    }
  } catch (error) {
    attempts.push(attempt("jina", error));
  }

  if (input.firecrawlApiKey) {
    try {
      const response = await request(fetcher, "https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.firecrawlApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: safe.url.toString(), formats: ["markdown"], onlyMainContent: true }),
      }, timeoutMs, signal);
      if (!response.ok) {
        attempts.push(await responseFailure("firecrawl", response));
      } else {
        const payload = await response.json() as { data?: { markdown?: unknown; metadata?: { title?: unknown } } };
        const markdown = payload.data?.markdown;
        if (typeof markdown !== "string") throw new Error("Firecrawl response has no Markdown");
        assertSourceContent(markdown);
        const title = payload.data?.metadata?.title;
        return {
          ok: true,
          provider: "firecrawl",
          archive: await archiveSource({
            sessionDir: input.sessionDir,
            kind: "read",
            sourceUrl: safe.url.toString(),
            ...(typeof title === "string" && title ? { title } : {}),
            content: markdown,
          }),
        };
      }
    } catch (error) {
      attempts.push(attempt("firecrawl", error));
    }
  }

  return {
    ok: false,
    error: {
      code: "all_readers_failed",
      message: input.firecrawlApiKey
        ? "Jina and Firecrawl could not read the URL"
        : "Jina could not read the URL; FIRECRAWL_API_KEY is not configured for fallback",
      attempts,
    },
  };
}

type TavilyResult = { title?: unknown; url?: unknown; content?: unknown; score?: unknown };

function cleanSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function searchCandidates(results: TavilyResult[]): WebSearchCandidate[] {
  return results.map((result, index) => ({
    title: typeof result.title === "string" && result.title.trim() ? cleanSearchText(result.title) : `Result ${index + 1}`,
    ...(typeof result.url === "string" && result.url.trim() ? { url: result.url.trim() } : {}),
    ...(typeof result.content === "string" && result.content.trim() ? { summary: cleanSearchText(result.content) } : {}),
    ...(typeof result.score === "number" ? { score: result.score } : {}),
  }));
}

function renderSearchResults(query: string, candidates: WebSearchCandidate[]): string {
  const sections = [`# Web search candidates: ${query}`, ""];
  candidates.forEach((result, index) => {
    sections.push(`## ${index + 1}. ${result.title}`);
    if (result.url) sections.push("", `URL: ${result.url}`);
    if (result.score !== undefined) sections.push(`Search score: ${result.score}`);
    if (result.summary) sections.push("", `Summary: ${result.summary}`);
    sections.push("");
  });
  return sections.join("\n");
}

export function renderSearchCandidatesText(input: { query: string; archivePath: string; readablePath: string; candidates: WebSearchCandidate[] }): string {
  return [
    `Discovery archive path: ${input.archivePath}`,
    `Readable archive path: ${input.readablePath}`,
    "Use web_read on a candidate URL before creating evidence; this search snapshot is discovery-only. Search score is only a search-provider ranking signal, not evidence quality.",
    "",
    ...input.candidates.flatMap((candidate, index) => [
      `${index + 1}. ${candidate.title}`,
      ...(candidate.url ? [`   URL: ${candidate.url}`] : []),
      ...(candidate.score !== undefined ? [`   Search score: ${candidate.score}`] : []),
      ...(candidate.summary ? [`   Summary: ${candidate.summary}`] : []),
      "",
    ]),
  ].join("\n");
}

export async function searchWeb(input: {
  sessionDir: string;
  query: string;
  tavilyApiKey?: string;
  maxResults?: number;
} & FetchOptions): Promise<WebSearchResult> {
  if (!input.tavilyApiKey) {
    return {
      ok: false,
      error: { code: "missing_api_key", message: "TAVILY_API_KEY is not configured", attempts: [] },
    };
  }
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  try {
    const response = await request(fetcher, "https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: input.tavilyApiKey,
        query: input.query,
        max_results: Math.min(Math.max(input.maxResults ?? 5, 1), 10),
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
      }),
    }, timeoutMs, signal);
    if (!response.ok) {
      const failure = await responseFailure("tavily", response);
      return { ok: false, error: { code: "search_failed", message: "Tavily search failed", attempts: [failure] } };
    }
    const payload = await response.json() as { results?: unknown };
    if (!Array.isArray(payload.results)) throw new Error("Tavily response has no results array");
    const candidates = searchCandidates(payload.results as TavilyResult[]);
    const content = renderSearchResults(input.query, candidates);
    return {
      ok: true,
      provider: "tavily",
      resultCount: candidates.length,
      candidates,
      archive: await archiveSource({ sessionDir: input.sessionDir, kind: "search", title: input.query, content }),
    };
  } catch (error) {
    return {
      ok: false,
      error: { code: "search_failed", message: "Tavily search failed", attempts: [attempt("tavily", error)] },
    };
  }
}
