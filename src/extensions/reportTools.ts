import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeReport } from "../tools/report.js";
import { piSessionDirectory } from "./sessionPath.js";

export function registerReportTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "report_write",
    label: "Write Verified Report",
    description: "Write a Markdown EBM report only after verifying every referenced evidence record against its archived source.",
    promptSnippet: "Persist a final Markdown report with verified evidence references",
    promptGuidelines: [
      "Reference evidence records using their ev_ identifiers in the Markdown before calling report_write.",
      "Set allow_no_evidence only when the report explicitly documents an evidence gap rather than making supported claims.",
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      markdown: Type.String({ minLength: 1 }),
      allow_no_evidence: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const report = await writeReport({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        title: params.title,
        content: params.markdown,
        ...(params.allow_no_evidence === undefined ? {} : { allowNoEvidence: params.allow_no_evidence }),
      });
      pi.events.emit("ebm:report_written", { sessionId, path: report.path, evidenceIds: report.evidenceIds });
      return {
        content: [{
          type: "text",
          text: `Verified report written: ${report.path}\nEvidence records: ${report.evidenceIds.length}\nSHA-256: ${report.sha256}`,
        }],
        details: report,
      };
    },
  });
}
