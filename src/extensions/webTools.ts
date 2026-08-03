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
    description: "Search the local curated source library (for example data/source_library/guidelines) without network access. Use to supplement guideline MCP when known local guidelines or parsed full texts may exist.",
    promptSnippet: "Search local curated guidelines/source cache before web fallbacks",
    promptGuidelines: ["Use Chinese queries for Chinese guideline/library content; use source_url from a hit with web_read to archive the full local source into the current session."],
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
        ...(candidates.length ? ["These are local archived sources with provenance. Prefer reading a relevant local hit before repeating PubMed/web search; re-search only for a specific freshness gap, missing identifier, or conflicting source.", "", ...candidates.flatMap((candidate, index) => [
          `${index + 1}. ${candidate.title}`,
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
    promptGuidelines: ["After reading, use the returned read_id with source_path and exact start_text/end_text in evidence_add; if unavailable, use source_path plus the visible line range. Never reconstruct or join source text."],
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
