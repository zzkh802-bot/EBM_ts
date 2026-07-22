import { archiveSource, type SourceArchiveRecord } from "./archive.js";
import { parseDocumentBytes, parseDocumentUrl } from "./mineru.js";
import { downloadPdf } from "./openAlex.js";
import { jinaReaderUrl, validateOutboundUrl } from "./urlSafety.js";

export type NetworkAttempt = {
  provider: "mineru" | "jina" | "firecrawl" | "tavily";
  message: string;
  status?: number;
};

export type WebToolError = {
  code: "unsafe_url" | "missing_api_key" | "all_readers_failed" | "search_failed";
  message: string;
  attempts: NetworkAttempt[];
};

export type WebReadResult =
  | { ok: true; provider: "mineru" | "jina" | "firecrawl"; archive: SourceArchiveRecord }
  | { ok: false; error: WebToolError };

export type WebSearchResult =
  | { ok: true; provider: "tavily"; archive: SourceArchiveRecord; resultCount: number }
  | { ok: false; error: WebToolError };

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

function firstMarkdownTitle(markdown: string): string | undefined {
  const title = markdown.split("\n").map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim()).find(Boolean);
  return title || undefined;
}

function pdfFileName(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
    return /^[^/\\]+\.pdf$/i.test(name) ? name : "document.pdf";
  } catch {
    return "document.pdf";
  }
}

async function request(fetcher: typeof fetch, input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
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
  resolveHost?: (host: string) => Promise<string[]>;
} & FetchOptions): Promise<WebReadResult> {
  const safe = validateOutboundUrl(input.url);
  if (!safe.ok) {
    return { ok: false, error: { code: "unsafe_url", message: safe.reason, attempts: [] } };
  }
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const attempts: NetworkAttempt[] = [];
  const isDocument = /\.(?:pdf|docx?|pptx?|xlsx?|epub|mobi)(?:$|[?#&])/i.test(safe.url.toString());
  const isPdf = /\.pdf(?:$|[?#&])/i.test(safe.url.toString());

  if (isDocument && input.mineruApiToken) {
    try {
      const parsed = await parseDocumentUrl({
        url: safe.url.toString(),
        apiToken: input.mineruApiToken,
        fetcher,
        ...(input.mineruBaseUrl ? { baseUrl: input.mineruBaseUrl } : {}),
        requestTimeoutMs: timeoutMs,
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
        });
        const parsed = await parseDocumentBytes({
          bytes: downloaded.bytes,
          fileName: pdfFileName(downloaded.finalUrl),
          apiToken: input.mineruApiToken,
          fetcher,
          ...(input.mineruBaseUrl ? { baseUrl: input.mineruBaseUrl } : {}),
          requestTimeoutMs: timeoutMs,
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
          }),
        };
      } catch (error) {
        attempts.push(attempt("mineru", new Error(`Premium local-upload fallback failed: ${error instanceof Error ? error.message : String(error)}`)));
      }
    }
  }

  try {
    const response = await request(fetcher, jinaReaderUrl(safe.url.toString()), {
      headers: {
        Accept: "text/markdown",
        ...(input.jinaApiKey ? { Authorization: `Bearer ${input.jinaApiKey}` } : {}),
      },
    }, timeoutMs);
    if (!response.ok) {
      attempts.push(await responseFailure("jina", response));
    } else {
      const markdown = await response.text();
      if (!markdown.trim()) throw new Error("empty Markdown response");
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
      }, timeoutMs);
      if (!response.ok) {
        attempts.push(await responseFailure("firecrawl", response));
      } else {
        const payload = await response.json() as { data?: { markdown?: unknown; metadata?: { title?: unknown } } };
        const markdown = payload.data?.markdown;
        if (typeof markdown !== "string" || !markdown.trim()) throw new Error("Firecrawl response has no Markdown");
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

function renderSearchResults(query: string, results: TavilyResult[]): string {
  const sections = [`# Web search: ${query}`, ""];
  results.forEach((result, index) => {
    const title = typeof result.title === "string" && result.title ? result.title : `Result ${index + 1}`;
    sections.push(`## ${index + 1}. ${title}`);
    if (typeof result.url === "string") sections.push("", `URL: ${result.url}`);
    if (typeof result.score === "number") sections.push(`Relevance: ${result.score}`);
    if (typeof result.content === "string" && result.content.trim()) sections.push("", result.content.trim());
    sections.push("");
  });
  return sections.join("\n");
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
    }, timeoutMs);
    if (!response.ok) {
      const failure = await responseFailure("tavily", response);
      return { ok: false, error: { code: "search_failed", message: "Tavily search failed", attempts: [failure] } };
    }
    const payload = await response.json() as { results?: unknown };
    if (!Array.isArray(payload.results)) throw new Error("Tavily response has no results array");
    const content = renderSearchResults(input.query, payload.results as TavilyResult[]);
    return {
      ok: true,
      provider: "tavily",
      resultCount: payload.results.length,
      archive: await archiveSource({ sessionDir: input.sessionDir, kind: "search", title: input.query, content }),
    };
  } catch (error) {
    return {
      ok: false,
      error: { code: "search_failed", message: "Tavily search failed", attempts: [attempt("tavily", error)] },
    };
  }
}
