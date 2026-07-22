import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeReport } from "../tools/report.js";
import path from "node:path";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

export function registerReportTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "report_write",
    label: "Write Verified Report",
    description: "Write a Markdown EBM report only after verifying every referenced evidence record against its archived source.",
    promptSnippet: "Persist a final Markdown report with verified evidence references",
    promptGuidelines: [
      "In the report body, cite evidence with numbered references like [1] or [1,2], not raw ev_ identifiers.",
      "Pass the hidden evidence mapping through the references parameter: each entry has number, real citation text, and evidence_id. The Markdown itself should contain real references, not ev_ identifiers.",
      "Write an argued EBM report: decompose the user's decision into sub-questions and claims, explain key terms, integrate evidence into reasoning, and avoid a source-by-source list.",
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
      const report = await writeReport({
        sessionDir,
        title: params.title,
        content: params.markdown,
        ...(params.references ? { references: params.references.map((reference) => ({ number: reference.number, citation: reference.citation, evidenceId: reference.evidence_id })) } : {}),
        ...(params.allow_no_evidence === undefined ? {} : { allowNoEvidence: params.allow_no_evidence }),
      });
      pi.events.emit("ebm:report_written", { sessionId, path: report.path, evidenceIds: report.evidenceIds });
      const readableReportPath = piReadableSessionPath(ctx.cwd, sessionId, report.path);
      return {
        content: [{
          type: "text",
          text: [
            `Session workspace: ${["data", "sessions", path.basename(sessionDir)].join("/")}`,
            `Verified report written: ${readableReportPath}`,
            `Evidence records: ${report.evidenceIds.length}`,
            `SHA-256: ${report.sha256}`,
          ].join("\n"),
        }],
        details: { ...report, readablePath: readableReportPath, sessionWorkspace: ["data", "sessions", path.basename(sessionDir)].join("/") },
      };
    },
  });
}
