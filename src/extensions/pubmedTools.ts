import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readPubMed, searchPubMed, similarPubMed, type PubMedError } from "../tools/pubmed.js";
import { quoteReadySourceSpans, type QuoteReadySourceSpan } from "../tools/sourceIdentity.js";
import { upsertSourceLibraryFromArchive } from "../tools/sourceLibrary.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function toolError(error: PubMedError): Error {
  return new Error(JSON.stringify(error));
}

function compactAbstractText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function abstractPreview(archive: { content: string }): string {
  const sourceLines = archive.content.split("\n");
  const headingIndex = sourceLines.findIndex((line) => line.trim() === "## Abstract");
  let firstIndex = headingIndex >= 0 ? headingIndex + 1 : 0;
  while (firstIndex < sourceLines.length && !sourceLines[firstIndex]!.trim()) firstIndex += 1;
  const nextHeadingIndex = sourceLines.findIndex((line, index) => index > firstIndex && /^##\s+/.test(line.trim()));
  let lastIndex = (nextHeadingIndex >= 0 ? nextHeadingIndex : sourceLines.length) - 1;
  while (lastIndex >= firstIndex && !sourceLines[lastIndex]!.trim()) lastIndex -= 1;
  return compactAbstractText(sourceLines.slice(firstIndex, lastIndex + 1).join(" "));
}

function pmidFromAbstract(content: string): string {
  return content.match(/^PMID:\s*(\d+)$/m)?.[1] ?? "unknown";
}

export function renderAbstractNavigation(
  sessionDirectoryName: string,
  archives: Array<{ path: string; title?: string; content: string; bodyLineStart: number; sourceId?: string; documentId?: string; quoteReadySpans?: QuoteReadySourceSpan[] }>,
  options: { searchArchivePath?: string; pmids?: string[] } = {},
): string {
  if (!archives.length) {
    const lines = ["No complete PubMed abstracts were archived as citation-capable sources.", ""];
    if (options.pmids?.length) {
      lines.push(`PubMed returned ${options.pmids.length} PMID(s): ${options.pmids.join(", ")}.`, "These records may lack abstracts or only have metadata in the search snapshot.", "Call `pubmed_read(identifier=\"PMID: ...\")` for any decision-relevant PMID before using it as evidence.", "");
    } else {
      lines.push(
        "PubMed returned no PMID results for this query.",
        "Search strategy hint: avoid long natural-language comparator queries. Retry once with a compact English keyword ladder: known PMID/DOI → exact title phrase → first author + distinctive title words → 3-7 key terms such as disease + intervention + study type. Remove words such as versus, compared with, standard-dose multi-agent unless they are exact title terms.",
        "",
      );
    }
    if (options.searchArchivePath) {
      const readablePath = ["data", "sessions", sessionDirectoryName, options.searchArchivePath].join("/");
      lines.push(`Readable search snapshot: ${readablePath}`, "This search snapshot is discovery history only and is not citation-capable evidence.");
    }
    return lines.join("\n");
  }
  const lines = ["PubMed abstract results:", ""];
  archives.forEach((archive, index) => {
    const readablePath = ["data", "sessions", sessionDirectoryName, archive.path].join("/");
    const preview = abstractPreview(archive);
    lines.push(
      `${index + 1}. ${archive.title ?? archive.path}`,
      `   PMID: ${pmidFromAbstract(archive.content)}`,
      `   Abstract preview: ${preview}`,
      `   Readable abstract path: ${readablePath}`,
      ...(archive.sourceId ? [`   Source ID: ${archive.sourceId}`] : []),
      ...(archive.documentId ? [`   Document ID: ${archive.documentId}`] : []),
      ...(archive.quoteReadySpans?.length ? [
        "   Quote-ready Abstract spans (prefer one source_span_id with evidence_add):",
        ...archive.quoteReadySpans.flatMap((span) => [`   source_span_id: ${span.id}`, ...span.quote.split("\n").map((line) => `     ${line}`)]),
      ] : []),
      "   Evidence use: prefer one source_span_id above; otherwise pass source_id and copy a minimal, sufficient, continuous verbatim quote from the archived Abstract section.",
      "",
    );
  });
  return lines.join("\n");
}

function abstractSection(content: string): string {
  const match = /(?:^|\n)## Abstract\s*\n+([\s\S]*?)(?=\n##\s|$)/.exec(content);
  return match?.[1]?.trim() || content;
}

async function pubMedQuoteReadySpans(sessionDir: string, archive: { path: string; sourceId: string; content: string }): Promise<QuoteReadySourceSpan[]> {
  return quoteReadySourceSpans({
    sessionDir,
    sourcePath: archive.path,
    sourceId: archive.sourceId,
    content: abstractSection(archive.content),
    maxSpans: 8,
  });
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
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const sourceLibraryWrites = await Promise.all(result.abstractArchives.map((archive) => upsertSourceLibraryFromArchive({ sourceLibraryDir, archive, provider: "pubmed", sessionId, sourceStatus: "primary_abstract", discoveryQuery: params.query })));
      result.abstractArchives.forEach((archive, index) => pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "pubmed",
        path: archive.path,
        kind: "read",
        sourceStatus: "primary_abstract",
        sourceLibraryPath: sourceLibraryWrites[index]?.path,
        sourceLibraryWritten: sourceLibraryWrites[index]?.written,
      }));
      const abstractCards = await Promise.all(result.abstractArchives.map(async (archive) => ({
        ...archive,
        quoteReadySpans: await pubMedQuoteReadySpans(sessionDir, archive),
      })));
      return {
        content: [{
          type: "text",
          text: renderAbstractNavigation(path.basename(sessionDir), abstractCards, { searchArchivePath: result.archive.path, pmids: result.pmids }),
        }],
        details: {
          pmids: result.pmids,
          relatedPmids: result.relatedPmids,
          abstractCount: result.abstractCount,
          abstractArchives: result.abstractArchives.map((archive, index) => ({ ...archiveDetails(archive), sourceSpanIds: abstractCards[index]?.quoteReadySpans.map((span) => span.id) ?? [] })),
          sourceLibrary: sourceLibraryWrites,
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
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const sourceLibraryWrites = await Promise.all(result.abstractArchives.map((archive) => upsertSourceLibraryFromArchive({ sourceLibraryDir, archive, provider: "pubmed", sessionId, sourceStatus: "primary_abstract", discoveryQuery: `similar to PMID ${params.pmid}` })));
      result.abstractArchives.forEach((archive, index) => pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "pubmed",
        path: archive.path,
        kind: "read",
        sourceStatus: "primary_abstract",
        sourceLibraryPath: sourceLibraryWrites[index]?.path,
        sourceLibraryWritten: sourceLibraryWrites[index]?.written,
      }));
      const abstractCards = await Promise.all(result.abstractArchives.map(async (archive) => ({
        ...archive,
        quoteReadySpans: await pubMedQuoteReadySpans(sessionDir, archive),
      })));
      return {
        content: [{ type: "text", text: renderAbstractNavigation(path.basename(sessionDir), abstractCards) }],
        details: {
          seedPmid: result.seedPmid,
          relatedPmids: result.relatedPmids,
          abstractArchives: result.abstractArchives.map((archive, index) => ({ ...archiveDetails(archive), sourceSpanIds: abstractCards[index]?.quoteReadySpans.map((span) => span.id) ?? [] })),
          sourceLibrary: sourceLibraryWrites,
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
    parameters: Type.Object({
      identifier: Type.String({ minLength: 1, description: "PMID, PMCID, or DOI" }),
      include_context: Type.Optional(Type.Boolean({ default: false, description: "For abstract-only records, also fetch compact Similar articles and Cited by hints. Slower; use for exploration, not routine evidence reads." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving PubMed record…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await readPubMed({
        sessionDir,
        identifier: params.identifier,
        ...(params.include_context === undefined ? {} : { includeContext: params.include_context }),
        ...ncbiOptions(),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const quoteReadySpans = await pubMedQuoteReadySpans(sessionDir, result.archive);
      const output = archiveToolText(result.archive, piReadableSessionPath(ctx.cwd, sessionId, result.archive.path), { compactRead: true, quoteReadySpans });
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const library = await upsertSourceLibraryFromArchive({ sourceLibraryDir, archive: result.archive, provider: "pubmed", sessionId, sourceStatus: result.fullText ? result.fullTextSource : "abstract_only" });
      const warningText = result.warnings.length ? `\n\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
      pi.events.emit("ebm:source_archived", { sessionId, provider: "pubmed", path: result.archive.path, kind: "read", pmid: result.pmid, sourceLibraryPath: library.path, sourceLibraryWritten: library.written });
      return {
        content: [{ type: "text", text: `${output.text}${warningText}` }],
        details: {
          pmid: result.pmid,
          ...(result.pmcid ? { pmcid: result.pmcid } : {}),
          fullText: result.fullText,
          fullTextSource: result.fullTextSource,
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          sourceSpanIds: quoteReadySpans.map((span) => span.id),
          sourceLibrary: library,
          truncated: output.truncated,
        },
      };
    },
  });
}
