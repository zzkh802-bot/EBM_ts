import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readPubMed, searchPubMed, type PubMedError } from "../tools/pubmed.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { piSessionDirectory } from "./sessionPath.js";

function toolError(error: PubMedError): Error {
  return new Error(JSON.stringify(error));
}

function ncbiOptions() {
  return {
    ...(process.env.NCBI_EMAIL ? { email: process.env.NCBI_EMAIL } : {}),
    ...(process.env.NCBI_API_KEY ? { apiKey: process.env.NCBI_API_KEY } : {}),
  };
}

export function registerPubMedTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "pubmed_search",
    label: "Search PubMed",
    description: "Search PubMed and archive batched abstracts plus concise similar-article discovery hints in one call.",
    promptSnippet: "Search biomedical literature with abstracts and related-article hints",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "PubMed query; field tags and Boolean operators are supported" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      include_similar: Type.Optional(Type.Boolean({ default: true })),
      max_similar: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, default: 5 })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching PubMed and archiving metadata…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await searchPubMed({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...(params.include_similar === undefined ? {} : { includeSimilar: params.include_similar }),
        ...(params.max_similar === undefined ? {} : { maxSimilar: params.max_similar }),
        ...ncbiOptions(),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive);
      pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "pubmed",
        path: result.archive.path,
        kind: "search",
        resultCount: result.pmids.length,
      });
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          pmids: result.pmids,
          relatedPmids: result.relatedPmids,
          abstractCount: result.abstractCount,
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          truncated: output.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "pubmed_read",
    label: "Read PubMed",
    description: "Resolve a PMID, PMCID, or DOI and fetch PMC full text when available; return an explicit abstract-only partial result otherwise.",
    promptSnippet: "Acquire full text for one PubMed record, preferring PMC",
    parameters: Type.Object({ identifier: Type.String({ minLength: 1, description: "PMID, PMCID, or DOI" }) }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving PubMed record…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await readPubMed({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        identifier: params.identifier,
        ...(process.env.MINERU_API_TOKEN ? { mineruApiToken: process.env.MINERU_API_TOKEN } : {}),
        ...(process.env.MINERU_BASE_URL ? { mineruBaseUrl: process.env.MINERU_BASE_URL } : {}),
        ...ncbiOptions(),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive);
      const warningText = result.warnings.length ? `\n\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
      pi.events.emit("ebm:source_archived", { sessionId, provider: "pubmed", path: result.archive.path, kind: "read", pmid: result.pmid });
      return {
        content: [{ type: "text", text: `${output.text}${warningText}` }],
        details: {
          pmid: result.pmid,
          ...(result.pmcid ? { pmcid: result.pmcid } : {}),
          fullText: result.fullText,
          fullTextSource: result.fullTextSource,
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          truncated: output.truncated,
        },
      };
    },
  });
}
