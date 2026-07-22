import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readPubMed, searchPubMed, similarPubMed, type PubMedError } from "../tools/pubmed.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function toolError(error: PubMedError): Error {
  return new Error(JSON.stringify(error));
}

function compactAbstractText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function abstractWindow(archive: { content: string; bodyLineStart: number }): { offset: number; limit: number; preview: string } {
  const sourceLines = archive.content.split("\n");
  const headingIndex = sourceLines.findIndex((line) => line.trim() === "## Abstract");
  let firstIndex = headingIndex >= 0 ? headingIndex + 1 : 0;
  while (firstIndex < sourceLines.length && !sourceLines[firstIndex]!.trim()) firstIndex += 1;
  let lastIndex = sourceLines.length - 1;
  while (lastIndex >= firstIndex && !sourceLines[lastIndex]!.trim()) lastIndex -= 1;
  const offset = archive.bodyLineStart + firstIndex;
  const limit = Math.max(1, lastIndex - firstIndex + 1);
  return { offset, limit, preview: compactAbstractText(sourceLines.slice(firstIndex, lastIndex + 1).join(" ")) };
}

function pmidFromAbstract(content: string): string {
  return content.match(/^PMID:\s*(\d+)$/m)?.[1] ?? "unknown";
}

export function renderAbstractNavigation(sessionDirectoryName: string, archives: Array<{ path: string; title?: string; content: string; bodyLineStart: number }>): string {
  if (!archives.length) return "No complete PubMed abstracts were archived as citation-capable sources.";
  const lines = ["PubMed abstract results:", ""];
  archives.forEach((archive, index) => {
    const readablePath = ["data", "sessions", sessionDirectoryName, archive.path].join("/");
    const { offset, limit, preview } = abstractWindow(archive);
    lines.push(
      `${index + 1}. ${archive.title ?? archive.path}`,
      `   PMID: ${pmidFromAbstract(archive.content)}`,
      `   Abstract preview: ${preview}`,
      `   Readable abstract path: ${readablePath}`,
      `   Exact abstract lines: ${offset}-${offset + limit - 1}`,
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
    description: "Search PubMed in one batch and separately archive each complete abstract as a citation-capable read source.",
    promptSnippet: "Search biomedical literature and receive separate primary_abstract source paths",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "PubMed query; field tags and Boolean operators are supported" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching PubMed and archiving metadata…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await searchPubMed({
        sessionDir,
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...ncbiOptions(),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);

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
        content: [{
          type: "text",
          text: renderAbstractNavigation(path.basename(sessionDir), result.abstractArchives),
        }],
        details: {
          pmids: result.pmids,
          relatedPmids: result.relatedPmids,
          abstractCount: result.abstractCount,
          abstractArchives: result.abstractArchives.map(archiveDetails),
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          truncated: false,
        },
      };
    },
  });

  pi.registerTool({
    name: "pubmed_similar",
    label: "Find Similar PubMed Articles",
    description: "Expand from one PMID to similar PubMed articles; returns Top-K titles, PMIDs, and abstract previews without full search archive noise.",
    promptSnippet: "Find related PubMed articles from a seed PMID",
    parameters: Type.Object({
      pmid: Type.String({ minLength: 1, description: "Seed PMID, with or without PMID: prefix" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Finding similar PubMed articles…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await similarPubMed({
        sessionDir,
        pmid: params.pmid,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...ncbiOptions(),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      pi.events.emit("ebm:source_archived", { sessionId, provider: "pubmed", path: result.archive.path, kind: "search", resultCount: result.relatedPmids.length });
      result.abstractArchives.forEach((archive) => pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "pubmed",
        path: archive.path,
        kind: "read",
        sourceStatus: "primary_abstract",
      }));
      return {
        content: [{ type: "text", text: renderAbstractNavigation(path.basename(sessionDir), result.abstractArchives) }],
        details: {
          seedPmid: result.seedPmid,
          relatedPmids: result.relatedPmids,
          abstractArchives: result.abstractArchives.map(archiveDetails),
          archive: archiveDetails(result.archive),
          warnings: result.warnings,
          truncated: false,
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
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await readPubMed({
        sessionDir,
        identifier: params.identifier,
        ...(process.env.MINERU_API_TOKEN ? { mineruApiToken: process.env.MINERU_API_TOKEN } : {}),
        ...(process.env.MINERU_V4_BASE_URL ? { mineruBaseUrl: process.env.MINERU_V4_BASE_URL } : {}),
        ...ncbiOptions(),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, piReadableSessionPath(ctx.cwd, sessionId, result.archive.path), { compactRead: true });
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
