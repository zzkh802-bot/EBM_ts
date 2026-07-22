import path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { addEvidence, listEvidence, readEvidence } from "../tools/evidence.js";
import { registerCompactionArtifacts } from "./compactionArtifacts.js";
import { registerEbmIdentity } from "./ebmIdentity.js";
import { registerGuidelineTools } from "./guidelineTools.js";
import { registerPubMedTools } from "./pubmedTools.js";
import { registerReportTools } from "./reportTools.js";
import { piSessionDirectory } from "./sessionPath.js";
import { registerTrajectoryRecorder } from "./trajectoryRecorder.js";
import { registerWebTools } from "./webTools.js";

export function registerEbmTools(pi: ExtensionAPI): void {
  registerEbmIdentity(pi);

  pi.registerTool({
    name: "evidence_add",
    label: "Add Evidence",
    description: "Archive an exact line slice from a session source as a traceable Markdown evidence record.",
    promptSnippet: "Archive exact source lines as claim-linked EBM evidence",
    promptGuidelines: [
      "Use evidence_add only after reading the exact archived source window; reuse the same source_path, offset, and limit.",
      "Classify provenance honestly. Search snippets and unverified mirrors are discovery-only and cannot support a final report.",
      "For secondary sources, attribute claims to that source; never rewrite a paraphrase as the target guideline's direct recommendation.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "Complete internal evidence question" }),
      claim: Type.String({ description: "Claim interpreted from this exact source slice" }),
      relation: StringEnum(["supports", "partially_supports", "refutes"] as const),
      provenance: Type.Optional(StringEnum([
        "primary_full_text",
        "primary_abstract",
        "guideline_official",
        "guideline_mirror_verified",
        "guideline_mirror_unverified",
        "secondary_direct_quote",
        "secondary_paraphrase",
        "independent_guideline",
        "discovery_only",
        "other",
      ] as const)),
      source_path: Type.String({ description: "Session-relative archived source Markdown path" }),
      offset: Type.Integer({ minimum: 0, description: "Zero-based source line offset" }),
      limit: Type.Integer({ minimum: 1, maximum: 200, description: "Number of consecutive exact source lines" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const indexPath = path.join(sessionDir, "evidence", "EVIDENCE.md");
      const node = await withFileMutationQueue(indexPath, () => addEvidence({
        sessionDir,
        question: params.question,
        claim: params.claim,
        relation: params.relation,
        ...(params.provenance ? { provenance: params.provenance } : {}),
        sourcePath: params.source_path.replace(/^@/, ""),
        offset: params.offset,
        limit: params.limit,
      }));
      const evidencePath = path.posix.join("evidence", `${node.id}.md`);
      pi.events.emit("ebm:evidence_added", { sessionId, evidenceId: node.id, path: evidencePath });
      return {
        content: [{
          type: "text",
          text: `Evidence archived: ${evidencePath}\nExact source: ${node.sourcePath}:${node.lineStart}-${node.lineEnd}`,
        }],
        details: { path: evidencePath, evidenceId: node.id, node },
      };
    },
  });

  pi.registerTool({
    name: "evidence_list",
    label: "List Evidence",
    description: "List concise summaries of all Markdown evidence records in the current Pi session.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const items = await listEvidence(piSessionDirectory(ctx.cwd, sessionId));
      return {
        content: [{ type: "text", text: items.length ? JSON.stringify(items, null, 2) : "No evidence records found." }],
        details: { items },
      };
    },
  });

  pi.registerTool({
    name: "evidence_read",
    label: "Read Evidence",
    description: "Read and verify one Markdown evidence record by evidence id before citing it.",
    parameters: Type.Object({
      evidence_id: Type.String({ pattern: "^ev_[a-f0-9]{16}$" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const record = await readEvidence(piSessionDirectory(ctx.cwd, sessionId), params.evidence_id);
      const truncated = truncateHead(record.markdown, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
      const suffix = truncated.truncated
        ? `\n\n[Evidence output truncated. Full record: evidence/${params.evidence_id}.md]`
        : "";
      return {
        content: [{ type: "text", text: `${truncated.content}${suffix}` }],
        details: { node: record.node, verification: record.verification, truncated: truncated.truncated },
      };
    },
  });

  registerWebTools(pi);
  registerPubMedTools(pi);
  registerReportTools(pi);
  registerGuidelineTools(pi);
  registerCompactionArtifacts(pi);
  registerTrajectoryRecorder(pi);
}
