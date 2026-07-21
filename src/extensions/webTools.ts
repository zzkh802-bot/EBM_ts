import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SourceArchiveRecord } from "../tools/archive.js";
import { readWeb, searchWeb, type WebToolError } from "../tools/web.js";
import { piSessionDirectory } from "./sessionPath.js";

function toolError(error: WebToolError): Error {
  return new Error(JSON.stringify(error));
}

function archiveDetails(record: SourceArchiveRecord): Omit<SourceArchiveRecord, "content"> {
  const { content: _content, ...details } = record;
  return details;
}

function archiveText(record: SourceArchiveRecord): { text: string; truncated: boolean } {
  const excerpt = truncateHead(record.content, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const lineEnd = record.bodyLineOffset + excerpt.content.split("\n").length - 1;
  return {
    text: [
      `Archived source: ${record.path}`,
      `Visible excerpt maps to source offsets ${record.bodyLineOffset}-${lineEnd} (zero-based).`,
      "Use read on the archive for additional lines, then evidence_add with absolute source offsets.",
      "",
      excerpt.content,
      ...(excerpt.truncated ? ["", `[Output truncated; full normalized source is archived at ${record.path}]`] : []),
    ].join("\n"),
    truncated: excerpt.truncated,
  };
}

export function registerWebTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "web_read",
    label: "Read Web Source",
    description: "Read a public URL through Jina with Firecrawl fallback, normalize it, and archive it before model exposure.",
    promptSnippet: "Read and archive a public web source with stable citation offsets",
    promptGuidelines: ["Use the returned archive path and absolute offsets when creating evidence."],
    parameters: Type.Object({ url: Type.String({ description: "Public HTTP(S) URL" }) }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving URL…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await readWeb({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        url: params.url,
        ...(process.env.JINA_API_KEY ? { jinaApiKey: process.env.JINA_API_KEY } : {}),
        ...(process.env.FIRECRAWL_API_KEY ? { firecrawlApiKey: process.env.FIRECRAWL_API_KEY } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveText(result.archive);
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
    description: "Search the public web with Tavily and archive the complete normalized result set before model exposure.",
    promptSnippet: "Search and archive general web discovery results",
    promptGuidelines: ["Prefer PubMed tools for biomedical literature once available; use web_search for general discovery."],
    parameters: Type.Object({
      query: Type.String({ minLength: 2 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching and archiving results…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await searchWeb({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...(process.env.TAVILY_API_KEY ? { tavilyApiKey: process.env.TAVILY_API_KEY } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveText(result.archive);
      pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: result.provider,
        path: result.archive.path,
        kind: "search",
        resultCount: result.resultCount,
      });
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          provider: result.provider,
          resultCount: result.resultCount,
          archive: archiveDetails(result.archive),
          truncated: output.truncated,
        },
      };
    },
  });
}
