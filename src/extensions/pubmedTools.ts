import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readPubMed, searchPubMed, type PubMedError } from "../tools/pubmed.js";
import { archiveDetails, archiveToolText, readableArchivePath } from "./archiveOutput.js";
import { piSessionDirectory } from "./sessionPath.js";

function toolError(error: PubMedError): Error {
  return new Error(JSON.stringify(error));
}

export function renderAbstractNavigation(sessionId: string, archives: Array<{ path: string; title?: string; content: string; bodyLineStart: number }>): string {
  if (!archives.length) return "No complete PubMed abstracts were archived as citation-capable sources.";
  const lines = ["Evidence-ready PubMed abstracts (no pubmed_read call required):", ""];
  archives.forEach((archive, index) => {
    const sourceLines = archive.content.split("\n");
    const headingIndex = sourceLines.findIndex((line) => line.trim() === "## Abstract");
    let firstIndex = headingIndex >= 0 ? headingIndex + 1 : 0;
    while (firstIndex < sourceLines.length && !sourceLines[firstIndex]!.trim()) firstIndex += 1;
    let lastIndex = sourceLines.length - 1;
    while (lastIndex >= firstIndex && !sourceLines[lastIndex]!.trim()) lastIndex -= 1;
    const offset = archive.bodyLineStart + firstIndex;
    const limit = Math.max(1, lastIndex - firstIndex + 1);
    const readablePath = readableArchivePath(sessionId, archive.path);
    const firstReadLimit = Math.min(limit, 200);
    lines.push(
      `${index + 1}. ${archive.title ?? archive.path}`,
      `   Evidence source_path: ${archive.path}`,
      `   Readable abstract path: ${readablePath}`,
      `   Complete abstract lines: ${offset}-${offset + limit - 1}`,
      `   Read exact abstract: read(path=${JSON.stringify(readablePath)}, offset=${offset}, limit=${firstReadLimit}).`,
      ...(limit > firstReadLimit ? [`   Continue abstract: read(path=${JSON.stringify(readablePath)}, offset=${offset + firstReadLimit - 1}, limit=${limit - firstReadLimit + 1}); the boundary line is repeated.`] : []),
      "   Evidence provenance: primary_abstract",
      "",
    );
  });
  return lines.join("\n");
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
    description: "Search PubMed in one batch, keep reproducible search history, and separately archive each complete abstract as a citation-capable read source; similar-article hints remain discovery-only.",
    promptSnippet: "Search biomedical literature and receive separate primary_abstract source paths",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "PubMed query; field tags and Boolean operators are supported" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      include_similar: Type.Optional(Type.Boolean({ default: true })),
      max_similar: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, default: 5 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching PubMed and archiving metadata…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await searchPubMed({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...(params.include_similar === undefined ? {} : { includeSimilar: params.include_similar }),
        ...(params.max_similar === undefined ? {} : { maxSimilar: params.max_similar }),
        ...ncbiOptions(),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, readableArchivePath(sessionId, result.archive.path), { citationEligible: false });
      pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "pubmed",
        path: result.archive.path,
        kind: "search",
        resultCount: result.pmids.length,
      });
      result.abstractArchives.forEach((archive) => pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "pubmed",
        path: archive.path,
        kind: "read",
        sourceStatus: "primary_abstract",
      }));
      return {
        content: [{ type: "text", text: `${renderAbstractNavigation(sessionId, result.abstractArchives)}\n\n${output.text}` }],
        details: {
          pmids: result.pmids,
          relatedPmids: result.relatedPmids,
          abstractCount: result.abstractCount,
          abstractArchives: result.abstractArchives.map(archiveDetails),
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
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving PubMed record…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await readPubMed({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        identifier: params.identifier,
        ...(process.env.MINERU_API_TOKEN ? { mineruApiToken: process.env.MINERU_API_TOKEN } : {}),
        ...(process.env.MINERU_V4_BASE_URL ? { mineruBaseUrl: process.env.MINERU_V4_BASE_URL } : {}),
        ...ncbiOptions(),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, readableArchivePath(sessionId, result.archive.path), { compactRead: true });
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
