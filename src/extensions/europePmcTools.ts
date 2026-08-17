import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readEuropePmc, searchEuropePmc, type EuropePmcError } from "../tools/europePmc.js";
import { upsertSourceLibraryFromArchive } from "../tools/sourceLibrary.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { formatReadReceipt, registerArchiveReadReceipt } from "./readRegistry.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function toolError(error: EuropePmcError): Error {
  return new Error(JSON.stringify(error));
}

function abstractRange(archive: { content: string; bodyLineStart: number }): { startLine: number; endLine: number } {
  const sourceLines = archive.content.split("\n");
  const headingIndex = sourceLines.findIndex((line) => line.trim() === "## Abstract");
  let firstIndex = headingIndex >= 0 ? headingIndex + 1 : 0;
  while (firstIndex < sourceLines.length && !sourceLines[firstIndex]!.trim()) firstIndex += 1;
  const nextHeadingIndex = sourceLines.findIndex((line, index) => index > firstIndex && /^##\s+/.test(line.trim()));
  let lastIndex = (nextHeadingIndex >= 0 ? nextHeadingIndex : sourceLines.length) - 1;
  while (lastIndex >= firstIndex && !sourceLines[lastIndex]!.trim()) lastIndex -= 1;
  return {
    startLine: archive.bodyLineStart + firstIndex,
    endLine: archive.bodyLineStart + lastIndex,
  };
}

function renderSearchNavigation(
  sessionDirectoryName: string,
  archives: Array<{ path: string; title?: string; content: string; bodyLineStart: number }>,
  options: { searchArchivePath?: string; fullTextAvailable?: number } = {},
): string {
  if (!archives.length) {
    const lines = ["No complete Europe PMC abstracts were archived as citation-capable sources.", ""];
    if (options.searchArchivePath) {
      const readablePath = ["data", "sessions", sessionDirectoryName, options.searchArchivePath].join("/");
      lines.push(`Readable search snapshot: ${readablePath}`, "This search snapshot is discovery history only and is not citation-capable evidence.");
    }
    return lines.join("\n");
  }
  const lines = [
    `Europe PMC abstract results (complete abstracts inline below):`,
    "",
    ...(options.fullTextAvailable ? [`${options.fullTextAvailable} of the matched records are Open Access or in PMC; use europepmc_read to archive full text.`, ""] : []),
  ];
  archives.forEach((archive, index) => {
    const readablePath = ["data", "sessions", sessionDirectoryName, archive.path].join("/");
    const range = abstractRange(archive);
    lines.push(
      `${index + 1}. ${archive.title ?? archive.path}`,
      `   Abstract lines: ${range.startLine}-${range.endLine}`,
      `   Readable abstract path: ${readablePath}`,
      "   Evidence use: use evidence_add with source_path (the Readable abstract path above) and the matching absolute line_start/line_end, or the shortest distinctive continuous start_text/end_text. Prefer europepmc_read to archive the full text before citing a finding from these abstracts.",
      "",
      archive.content.trim(),
      "",
      "---",
      "",
    );
  });
  return lines.join("\n");
}

export function registerEuropePmcTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "europepmc_search",
    label: "Search Europe PMC",
    description: "Search Europe PMC abstracts (includes PubMed content and PMC OA content); separately archives each complete abstract as a citation-capable read source.",
    promptSnippet: "Search biomedical literature via Europe PMC and receive separate primary_abstract source paths",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "Europe PMC query; field tags and Boolean operators are supported" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching Europe PMC and archiving metadata…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await searchEuropePmc({
        sessionDir,
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);

      pi.events.emit("ebm:source_archived", { sessionId, provider: "europepmc", path: result.archive.path, kind: "search", resultCount: result.pmids.length });
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const sourceLibraryWrites = await Promise.all(result.abstractArchives.map((archive) => upsertSourceLibraryFromArchive({ sourceLibraryDir, archive, provider: "europepmc", sessionId, sourceStatus: "primary_abstract", discoveryQuery: params.query })));
      result.abstractArchives.forEach((archive, index) => pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "europepmc",
        path: archive.path,
        kind: "read",
        sourceStatus: "primary_abstract",
        sourceLibraryPath: sourceLibraryWrites[index]?.path,
        sourceLibraryWritten: sourceLibraryWrites[index]?.written,
      }));
      return {
        content: [{
          type: "text",
          text: renderSearchNavigation(path.basename(sessionDir), result.abstractArchives, { searchArchivePath: result.archive.path, fullTextAvailable: result.fullTextAvailable }),
        }],
        details: {
          pmids: result.pmids,
          pmcids: result.pmcids,
          abstractCount: result.abstractCount,
          fullTextAvailable: result.fullTextAvailable,
          abstractArchives: result.abstractArchives.map((archive) => archiveDetails(archive)),
          sourceLibrary: sourceLibraryWrites,
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          truncated: false,
        },
      };
    },
  });

  pi.registerTool({
    name: "europepmc_read",
    label: "Read Europe PMC",
    description: "Resolve a PMID, PMCID, or Europe PMC identifier and fetch Open Access full text from PMC when available; return an explicit abstract-only partial result otherwise.",
    promptSnippet: "Acquire Open Access full text for one record via Europe PMC",
    parameters: Type.Object({
      identifier: Type.String({ minLength: 1, description: "PMID, PMCID, or Europe PMC MED/PMC identifier" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving Europe PMC record…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await readEuropePmc({
        sessionDir,
        identifier: params.identifier,
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, piReadableSessionPath(ctx.cwd, sessionId, result.archive.path), { compactRead: true });
      const receipt = await registerArchiveReadReceipt({ sessionDir, archive: result.archive, lineStart: output.visibleStart, lineEnd: output.visibleEnd });
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const library = await upsertSourceLibraryFromArchive({ sourceLibraryDir, archive: result.archive, provider: "europepmc", sessionId, sourceStatus: result.fullText ? "europepmc_oa" : "abstract_only" });
      const warningText = result.warnings.length ? `\n\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
      pi.events.emit("ebm:source_archived", { sessionId, provider: "europepmc", path: result.archive.path, kind: "read", pmcid: result.pmcid, sourceLibraryPath: library.path, sourceLibraryWritten: library.written });
      return {
        content: [{ type: "text", text: `${output.text}${formatReadReceipt(receipt)}${warningText}` }],
        details: {
          pmcid: result.pmcid,
          ...(result.pmid ? { pmid: result.pmid } : {}),
          fullText: result.fullText,
          fullTextSource: result.fullTextSource,
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          sourceLibrary: library,
          readId: receipt.id,
          sourcePath: result.archive.path,
          sourceLines: [receipt.lineStart, receipt.lineEnd],
          truncated: output.truncated,
        },
      };
    },
  });
}