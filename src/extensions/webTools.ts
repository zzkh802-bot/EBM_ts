import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readWeb, renderSearchCandidatesText, searchWeb, type WebToolError } from "../tools/web.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function toolError(error: WebToolError): Error {
  return new Error(JSON.stringify(error));
}

export function registerWebTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "web_read",
    label: "Read Web Source",
    description: "Read documents through MinerU Premium or web pages through Jina with Firecrawl fallback, then normalize and archive before exposure.",
    promptSnippet: "Read and archive a public web source with stable citation offsets",
    promptGuidelines: ["Use the returned archive path and absolute offsets when creating evidence."],
    parameters: Type.Object({ url: Type.String({ description: "Public HTTP(S) URL" }) }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving URL…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await readWeb({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        url: params.url,
        ...(process.env.JINA_API_KEY ? { jinaApiKey: process.env.JINA_API_KEY } : {}),
        ...(process.env.FIRECRAWL_API_KEY ? { firecrawlApiKey: process.env.FIRECRAWL_API_KEY } : {}),
        ...(process.env.MINERU_API_TOKEN ? { mineruApiToken: process.env.MINERU_API_TOKEN } : {}),
        ...(process.env.MINERU_V4_BASE_URL ? { mineruBaseUrl: process.env.MINERU_V4_BASE_URL } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, piReadableSessionPath(ctx.cwd, sessionId, result.archive.path), { compactRead: true });
      pi.events.emit("ebm:source_archived", { sessionId, provider: result.provider, path: result.archive.path, kind: "read" });
      return {
        content: [{ type: "text", text: output.text }],
        details: { provider: result.provider, archive: archiveDetails(result.archive), truncated: output.truncated },
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
