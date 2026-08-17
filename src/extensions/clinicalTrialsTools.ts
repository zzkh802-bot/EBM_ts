import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readClinicalTrial, searchClinicalTrials, type ClinicalTrialsError } from "../tools/clinicalTrials.js";
import { upsertSourceLibraryFromArchive } from "../tools/sourceLibrary.js";
import { archiveDetails, archiveToolText } from "./archiveOutput.js";
import { formatReadReceipt, registerArchiveReadReceipt } from "./readRegistry.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function toolError(error: ClinicalTrialsError): Error {
  return new Error(JSON.stringify(error));
}

const INLINE_BUDGET_CHARS = 40_000;

function renderInlineStudies(sessionDirectoryName: string, archives: Array<{ path: string; title?: string; content: string }>, nctIds: string[]): { text: string; inlined: number } {
  const lines: string[] = [];
  let budget = INLINE_BUDGET_CHARS;
  let inlined = 0;
  for (const [index, archive] of archives.entries()) {
    const readablePath = ["data", "sessions", sessionDirectoryName, archive.path].join("/");
    const block = [
      `${index + 1}. ${archive.title ?? archive.path}`,
      `   Readable study path: ${readablePath}`,
      "   Evidence use: use evidence_add with source_path (the Readable study path above) and the matching absolute line_start/line_end, or the shortest distinctive continuous start_text/end_text.",
      "",
      archive.content.trim(),
      "",
      "---",
      "",
    ].join("\n");
    if (budget - block.length < 0 && inlined > 0) break;
    budget -= block.length;
    lines.push(block);
    inlined += 1;
  }
  if (inlined < archives.length) {
    const remaining = archives.length - inlined;
    lines.push(
      `…${remaining} more study protocol(s) not shown inline (context budget). NCT IDs: ${nctIds.slice(inlined).join(", ")}`,
      "Use clinicaltrials_read with an NCT ID to archive and read the full protocol.",
      "",
    );
  }
  return { text: lines.join("\n"), inlined };
}

export function registerClinicalTrialsTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "clinicaltrials_search",
    label: "Search ClinicalTrials.gov",
    description: "Search the ClinicalTrials.gov v2 API for interventional and observational trial registrations; returns a result index with NCT IDs plus per-study trial registration summaries, and archives each study as a citation-capable read source.",
    promptSnippet: "Search ClinicalTrials.gov trial registrations for a study question",
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "ClinicalTrials.gov search term (supports field tags like AREA[Condition] when needed)" }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching ClinicalTrials.gov and archiving trial registrations…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await searchClinicalTrials({
        sessionDir,
        query: params.query,
        ...(params.max_results === undefined ? {} : { maxResults: params.max_results }),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);

      pi.events.emit("ebm:source_archived", { sessionId, provider: "clinicaltrials", path: result.archive.path, kind: "search", resultCount: result.studyCount });
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const sourceLibraryWrites = await Promise.all(result.studyArchives.map((archive) => upsertSourceLibraryFromArchive({ sourceLibraryDir, archive, provider: "clinicaltrials", sessionId, sourceStatus: "primary_trial", discoveryQuery: params.query })));
      result.studyArchives.forEach((archive, index) => pi.events.emit("ebm:source_archived", {
        sessionId,
        provider: "clinicaltrials",
        path: archive.path,
        kind: "read",
        sourceStatus: "primary_trial",
        sourceLibraryPath: sourceLibraryWrites[index]?.path,
        sourceLibraryWritten: sourceLibraryWrites[index]?.written,
      }));
      const inline = renderInlineStudies(path.basename(sessionDir), result.studyArchives, result.nctIds);
      const lines = [
        `ClinicalTrials.gov search returned ${result.studyCount} matching trial registrations (${inline.inlined} full protocol(s) shown below).`,
        "",
        ...(result.nctIds.length ? [`All NCT IDs: ${result.nctIds.join(", ")}`, ""] : []),
        ...(inline.inlined ? [] : ["Use clinicaltrials_read with an NCT ID to archive the full study protocol as a citation-capable source.", ""]),
        ...(inline.text ? [inline.text] : []),
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          nctIds: result.nctIds,
          studyCount: result.studyCount,
          inlinedStudies: inline.inlined,
          studyArchives: result.studyArchives.map((archive) => archiveDetails(archive)),
          sourceLibrary: sourceLibraryWrites,
          warnings: result.warnings,
          archive: archiveDetails(result.archive),
          truncated: false,
        },
      };
    },
  });

  pi.registerTool({
    name: "clinicaltrials_read",
    label: "Read ClinicalTrials.gov study",
    description: "Fetch the full study protocol for a ClinicalTrials.gov NCT identifier and archive it as a citation-capable read source.",
    promptSnippet: "Archive the full protocol of a ClinicalTrials.gov study by NCT ID",
    parameters: Type.Object({
      nct_id: Type.String({ minLength: 5, description: "ClinicalTrials.gov NCT identifier, e.g. NCT03827343; NCT prefix optional" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving ClinicalTrials.gov study protocol…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const result = await readClinicalTrial({
        sessionDir,
        nctId: params.nct_id,
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw toolError(result.error);
      const output = archiveToolText(result.archive, piReadableSessionPath(ctx.cwd, sessionId, result.archive.path));
      const receipt = await registerArchiveReadReceipt({ sessionDir, archive: result.archive, lineStart: output.visibleStart, lineEnd: output.visibleEnd });
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const library = await upsertSourceLibraryFromArchive({ sourceLibraryDir, archive: result.archive, provider: "clinicaltrials", sessionId, sourceStatus: "primary_trial" });
      const warningText = result.warnings.length ? `\n\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
      pi.events.emit("ebm:source_archived", { sessionId, provider: "clinicaltrials", path: result.archive.path, kind: "read", sourceLibraryPath: library.path, sourceLibraryWritten: library.written });
      return {
        content: [{ type: "text", text: `${output.text}${formatReadReceipt(receipt)}${warningText}` }],
        details: {
          nctId: result.nctId,
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