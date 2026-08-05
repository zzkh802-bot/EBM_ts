import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readWeb, renderSearchCandidatesText, searchWeb, type WebToolError } from "../tools/web.js";
import { searchSourceLibrary, upsertSourceLibraryFromArchive } from "../tools/sourceLibrary.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function toolError(error: WebToolError): Error {
  return new Error(JSON.stringify(error));
}

function positiveEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function registerWebTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "source_library_search",
    label: "Search Local Source Library",
    description: "Search the persistent local curated source library without network access. It returns document-level historical candidates, not citation-ready evidence passages.",
    promptSnippet: "Search the accumulated local source library before MCP/PubMed/web fallbacks",
    promptGuidelines: ["This is a persistent cross-session index. Search it first for each new sub-question; if a direct hit has source_url, call web_read on that URL to materialize the cached source in the current session. Do not treat the result list or snippet as evidence. Use Chinese queries for Chinese guideline/library content.", "guideline_mcp_search returns document candidates only; use guideline_mcp_retrieve or a read operation for evidence passages."],
    parameters: Type.Object({
      query: Type.String({ minLength: 2 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching local source library…" }], details: {} });
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const candidates = await searchSourceLibrary({ sourceLibraryDir, query: params.query, limit: params.max_results ?? 10 });
      const lines = [
        `# Local source library search: ${params.query}`,
        "",
        `Results: ${candidates.length}`,
        "",
        ...(candidates.length ? ["These are local archived sources with provenance, ranked as discovery candidates. Prefer a direct local hit before MCP/PubMed/web; re-search only for a specific freshness gap, missing identifier, or conflicting source. The list itself is not citation evidence.", "", ...candidates.flatMap((candidate, index) => [
          `${index + 1}. ${candidate.title}`,
          `   Match quality: ${candidate.matchQuality}; matched query terms: ${candidate.matchedQueryTerms.join(", ") || "none"}`,
          `   Slug: ${candidate.slug}`,
          ...(candidate.sourceUrl ? [`   Source URL: ${candidate.sourceUrl}`, `   Next: web_read(url=${JSON.stringify(candidate.sourceUrl)}) will reuse the local library copy if source_url matches.`] : []),
          `   Acquisition route: ${candidate.discoveryQueries.length ? `${candidate.provider ?? "source"}_search(query=${JSON.stringify(candidate.discoveryQueries.at(-1))}) → ${candidate.sourceUrl ? `web_read(url=${JSON.stringify(candidate.sourceUrl)})` : "local archive"}` : `${candidate.provider ?? "unknown"}${candidate.sourceUrl ? ` read(url=${JSON.stringify(candidate.sourceUrl)})` : " local archive"}`}`,
          `   Provenance: provider=${candidate.provider ?? "unknown"}${candidate.sourceStatus ? `; status=${candidate.sourceStatus}` : ""}${candidate.importedFrom ? `; imported_from=${candidate.importedFrom}` : ""}${candidate.importedAt ? `; imported_at=${candidate.importedAt}` : ""}${candidate.accessCount !== undefined ? `; access_count=${candidate.accessCount}` : ""}`,
          ...(candidate.identifiers.pmid || candidate.identifiers.pmcid || candidate.identifiers.doi || candidate.identifiers.year || candidate.identifiers.publicationTypes.length ? [`   Identifiers: ${[
            candidate.identifiers.pmid ? `PMID ${candidate.identifiers.pmid}` : undefined,
            candidate.identifiers.pmcid ? `PMCID ${candidate.identifiers.pmcid}` : undefined,
            candidate.identifiers.doi ? `DOI ${candidate.identifiers.doi}` : undefined,
            candidate.identifiers.year ? `year ${candidate.identifiers.year}` : undefined,
            candidate.identifiers.publicationTypes.length ? candidate.identifiers.publicationTypes.join("; ") : undefined,
          ].filter(Boolean).join("; ")}`] : []),
          ...(candidate.discoveryQueries.length ? [`   Found before by query: ${candidate.discoveryQueries.slice(-2).join(" || ")}`] : []),
          ...(candidate.aliases.length ? [`   Aliases: ${candidate.aliases.join("; ")}`] : []),
          ...(candidate.snippet ? [`   Local summary/preview: ${candidate.snippet}`] : []),
          "",
        ])] : ["No local library entries matched. Use MCP/PubMed/web search as needed."]),
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { provider: "source_library", resultCount: candidates.length, candidates, sourceLibraryDir, sessionWorkspace: ["data", "sessions", path.basename(piSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId()))].join("/") },
      };
    },
  });

  pi.registerTool({
    name: "web_read",
    label: "Read Web Source",
    description: "Read documents through MinerU Premium or web pages through Jina with Firecrawl fallback, then normalize and archive before exposure.",
    promptSnippet: "Read and archive a public web source for quote-verified citation",
    promptGuidelines: ["After reading, choose read_id with start_text/end_text (source_path optional; line_start/line_end may optionally narrow inside that read), or source_path with line_start/line_end. Layout/XML/entity/punctuation noise is normalized, but never paraphrase, repair clinical text, or join discontinuous passages."],
    parameters: Type.Object({
      url: Type.String({ description: "Public HTTP(S) URL" }),
      pdf_pages: Type.Optional(Type.String({ description: "Optional focused PDF page range such as 1-5. Use only when the relevant pages are known; max 25 pages." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving URL…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const result = await readWeb({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        url: params.url,
        ...(process.env.JINA_API_KEY ? { jinaApiKey: process.env.JINA_API_KEY } : {}),
        ...(process.env.FIRECRAWL_API_KEY ? { firecrawlApiKey: process.env.FIRECRAWL_API_KEY } : {}),
        ...(process.env.MINERU_API_TOKEN ? { mineruApiToken: process.env.MINERU_API_TOKEN } : {}),
        ...(process.env.MINERU_V4_BASE_URL ? { mineruBaseUrl: process.env.MINERU_V4_BASE_URL } : {}),
        timeoutMs: positiveEnvInt("WEB_READ_REQUEST_TIMEOUT_MS", 30_000),
        totalTimeoutMs: positiveEnvInt("WEB_READ_TOTAL_TIMEOUT_MS", 45_000),
        maxPdfPagesForMineru: positiveEnvInt("PDF_MAX_PAGES_FOR_WEB_READ", 50),
        ...(params.pdf_pages ? { pdfPages: params.pdf_pages } : {}),
        sourceLibraryDir,
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, piReadableSessionPath(ctx.cwd, sessionId, result.archive.path), { compactRead: true });
      const library = result.provider === "library" ? { written: false } : await upsertSourceLibraryFromArchive({ sourceLibraryDir, archive: result.archive, provider: result.provider, sessionId });
      pi.events.emit("ebm:source_archived", { sessionId, provider: result.provider, path: result.archive.path, kind: "read", sourceLibraryPath: library.path, sourceLibraryWritten: library.written });
      const libraryTrustNote = result.provider === "library"
        ? "\n\nLocal library provenance: this source was read from the curated local archive using its source_url match. Treat it as an already archived citation-capable source; do not repeat PubMed/web search for the same source unless you need a newer version, a missing identifier, or conflict resolution."
        : "";
      return {
        content: [{ type: "text", text: `${output.text}${libraryTrustNote}` }],
        details: { provider: result.provider, archive: archiveDetails(result.archive), sourceLibrary: library, truncated: output.truncated },
      };
    },
  });

  pi.registerTool({
    name: "web_search",
    label: "Search Web",
    description: "Search the public web with Tavily, return Top-K candidate URLs with provider summaries, and archive the discovery snapshot for traceability.",
    promptSnippet: "Search and archive general web discovery results",
    promptGuidelines: ["Prefer PubMed tools for biomedical literature once available; use web_search for general discovery. Call web_read on a candidate URL before using it as evidence."],
    parameters: Type.Object({
      query: Type.String({ minLength: 2 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching and archiving results…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await searchWeb({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...(process.env.TAVILY_API_KEY ? { tavilyApiKey: process.env.TAVILY_API_KEY } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const readablePath = piReadableSessionPath(ctx.cwd, sessionId, result.archive.path);
      pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: result.provider,
        path: result.archive.path,
        kind: "search",
        resultCount: result.resultCount,
      });
      return {
        content: [{ type: "text", text: renderSearchCandidatesText({ query: params.query, archivePath: result.archive.path, readablePath, candidates: result.candidates }) }],
        details: {
          provider: result.provider,
          resultCount: result.resultCount,
          candidates: result.candidates,
          archive: archiveDetails(result.archive),
          truncated: false,
        },
      };
    },
  });
}
