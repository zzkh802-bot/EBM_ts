import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeReport, writeReportDraft } from "../tools/report.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function safeDraftPath(sessionDir: string, draftPath: string): { rel: string; abs: string } {
  const normalized = draftPath.replace(/^data\/sessions\/[^/]+\//, "").replace(/^\/+/, "");
  if (path.isAbsolute(normalized) || normalized.includes("..")) throw new Error("draft_path must be a relative session path");
  if (!/^reports\/drafts\/.+\.draft\.md$/.test(normalized)) throw new Error("draft_path must point to reports/drafts/*.draft.md");
  return { rel: normalized, abs: path.join(sessionDir, normalized) };
}

export function registerReportTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "report_write",
    label: "Write Verified Report",
    description: "Write a Markdown EBM report only after verifying every referenced evidence record against its archived source.",
    promptSnippet: "Persist a final Markdown report with verified evidence references",
    promptGuidelines: [
      "In the report body, cite evidence with numbered references like [1] or [1,2], not raw ev_ identifiers.",
      "Pass the hidden evidence mapping through the references parameter: citation numbers represent bibliographic sources. The same number may appear multiple times only when the citation text is the same, to map one source to multiple supporting evidence_id records. Do not use the same number for different citations.",
      "When references is provided, you may omit the Markdown reference list; the tool will append a renderable numbered reference section. Every reference number must be used by at least one decision-relevant body citation, and every body citation [n] must exist in references.",
      "Before calling report_write, run a citation preflight mentally: collect all body citation numbers before the reference section and all references[].number values as sets; the two sets must be identical. Duplicate reference numbers are allowed only for identical citation text mapping to additional evidence_id records.",
      "Before calling report_write, run a non-blocking clinical preflight: re-check case facts against the user's original information; keep unspecified facts unknown; recalculate any stated clinical score from its listed components; make patient-level eligibility and safety conclusions conditional on all required facts; and omit or explicitly qualify time-sensitive claims that lack a current authoritative source.",
      "Write an argued but concise EBM report: decompose the user's decision into sub-questions and claims, integrate evidence into reasoning, cite each key claim with numbered references, and avoid source-by-source lists or unnecessary method-log detail.",
      "Set allow_no_evidence only when the report explicitly documents an evidence gap rather than making supported claims.",
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      markdown: Type.String({ minLength: 1 }),
      references: Type.Optional(Type.Array(Type.Object({
        number: Type.Integer({ minimum: 1 }),
        citation: Type.String({ minLength: 1, description: "Real human-readable reference text, e.g. guideline title/year or PMID/DOI citation" }),
        evidence_id: Type.String({ pattern: "^ev_[a-f0-9]{16}$" }),
      }))),
      allow_no_evidence: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const input = {
        sessionDir,
        title: params.title,
        content: params.markdown,
        ...(params.references ? { references: params.references.map((reference) => ({ number: reference.number, citation: reference.citation, evidenceId: reference.evidence_id })) } : {}),
        ...(params.allow_no_evidence === undefined ? {} : { allowNoEvidence: params.allow_no_evidence }),
      };
      try {
        const report = await writeReport(input);
        pi.events.emit("ebm:report_written", { sessionId, path: report.path, evidenceIds: report.evidenceIds });
        const readableReportPath = piReadableSessionPath(ctx.cwd, sessionId, report.path);
        return {
          content: [{
            type: "text",
            text: [
              `Session workspace: ${["data", "sessions", path.basename(sessionDir)].join("/")}`,
              `Verified report written: ${readableReportPath}`,
              "This is already the final verified report; do not call report_finalize unless report_write saved an unverified reports/drafts/*.draft.md file.",
              `Evidence records: ${report.evidenceIds.length}`,
              `SHA-256: ${report.sha256}`,
            ].join("\n"),
          }],
          details: { ...report, readablePath: readableReportPath, sessionWorkspace: ["data", "sessions", path.basename(sessionDir)].join("/") },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const draft = await writeReportDraft(input, message);
        const readableDraftPath = piReadableSessionPath(ctx.cwd, sessionId, draft.path);
        return {
          content: [{
            type: "text",
            text: [
              `Report verification failed: ${message}`,
              `Unverified draft saved for local editing: ${readableDraftPath}`,
              "This is not a verified final report and has no evidence metadata. Use read/edit for local fixes, then call report_write again only when ready to verify the final report.",
            ].join("\n"),
          }],
          details: { verified: false, draft: { ...draft, readablePath: readableDraftPath }, error: message },
        };
      }
    },
  });

  pi.registerTool({
    name: "report_finalize",
    label: "Finalize Edited Draft Report",
    description: "Read an edited reports/drafts/*.draft.md file, verify evidence references, and publish it as a final Markdown EBM report.",
    promptSnippet: "Finalize a locally edited unverified draft without resending the full Markdown",
    promptGuidelines: [
      "Use this after report_write saved an unverified draft and the draft has been fixed with read/edit.",
      "Provide the draft_path returned by report_write and the references mapping. The tool reads the draft Markdown from disk, verifies citations/evidence, and writes the final report under reports/ on success.",
      "The draft reference section is only a preview. report_finalize regenerates the final reference section from the references parameter, so citation/reference changes must be reflected in references; editing only the draft reference text is not enough.",
      "Before finalizing, run the same non-blocking clinical preflight as for report_write: re-check case facts, recompute stated scores, preserve unknowns, condition patient-level eligibility or safety conclusions, and qualify unsupported time-sensitive claims.",
      "If finalization fails, edit only the reported local problem in the same draft and call report_finalize again; do not regenerate the whole report unless the clinical content itself is wrong.",
    ],
    parameters: Type.Object({
      draft_path: Type.String({ minLength: 1, description: "Relative session path like reports/drafts/name.draft.md, or the readable data/sessions/... path returned by report_write" }),
      title: Type.String({ minLength: 1 }),
      references: Type.Array(Type.Object({
        number: Type.Integer({ minimum: 1 }),
        citation: Type.String({ minLength: 1 }),
        evidence_id: Type.String({ pattern: "^ev_[a-f0-9]{16}$" }),
      })),
      allow_no_evidence: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const draft = safeDraftPath(sessionDir, params.draft_path);
      const markdown = await readFile(draft.abs, "utf8");
      const input = {
        sessionDir,
        title: params.title,
        content: markdown,
        references: params.references.map((reference) => ({ number: reference.number, citation: reference.citation, evidenceId: reference.evidence_id })),
        ...(params.allow_no_evidence === undefined ? {} : { allowNoEvidence: params.allow_no_evidence }),
      };
      try {
        const report = await writeReport(input);
        pi.events.emit("ebm:report_written", { sessionId, path: report.path, evidenceIds: report.evidenceIds });
        const readableReportPath = piReadableSessionPath(ctx.cwd, sessionId, report.path);
        return {
          content: [{
            type: "text",
            text: [
              `Verified report finalized from draft: ${piReadableSessionPath(ctx.cwd, sessionId, draft.rel)}`,
              `Final report written: ${readableReportPath}`,
              `Evidence records: ${report.evidenceIds.length}`,
              `SHA-256: ${report.sha256}`,
            ].join("\n"),
          }],
          details: { verified: true, ...report, readablePath: readableReportPath, draftPath: draft.rel },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: [
              `Report finalization failed: ${message}`,
              `Keep editing the same draft: ${piReadableSessionPath(ctx.cwd, sessionId, draft.rel)}`,
              "After the local issue is fixed with edit, call report_finalize again with the same draft_path and corrected references.",
            ].join("\n"),
          }],
          details: { verified: false, draftPath: draft.rel, error: message },
        };
      }
    },
  });
}
