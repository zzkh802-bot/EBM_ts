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
      const lines = [
        `Search returned ${result.studyCount} matching clinical trial registrations on ClinicalTrials.gov.`,
        "",
        ...(result.nctIds.length ? [`NCT IDs: ${result.nctIds.join(", ")}`, ""] : []),
        "Use clinicaltrials_read with an NCT ID to archive the full study protocol as a citation-capable source.",
      ];
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          nctIds: result.nctIds,
          studyCount: result.studyCount,
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