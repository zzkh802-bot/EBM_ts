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
import { registerContextPruner } from "./contextPruner.js";
import { registerEbmIdentity } from "./ebmIdentity.js";
import { registerGuidelineTools } from "./guidelineTools.js";
import { registerPubMedTools } from "./pubmedTools.js";
import { registerReportTools } from "./reportTools.js";
import { registerResearchFrameTools } from "./researchFrameTools.js";
import { piReadableSessionPath, piSessionDirectory, registerSessionWorkspace } from "./sessionPath.js";
import { registerTrajectoryRecorder } from "./trajectoryRecorder.js";
import { registerWebTools } from "./webTools.js";

function evidenceSourcePath(value: string, sessionId: string, sessionDir: string): string {
  const normalized = value.replace(/^@/, "").replaceAll("\\", "/").replace(/^\.\//, "");
  const workspacePrefixes = [`data/sessions/${path.basename(sessionDir)}/`, `data/sessions/${sessionId}/`];
  const workspacePrefix = workspacePrefixes.find((prefix) => normalized.startsWith(prefix));
  if (workspacePrefix) return normalized.slice(workspacePrefix.length);
  if (normalized.startsWith("data/sessions/")) throw new Error("source_path points to a different session workspace");
  return normalized;
}

export function registerEbmTools(pi: ExtensionAPI): void {
  const retrievalPolicy = process.env.EBM_RETRIEVAL_POLICY?.trim() || "all";
  registerSessionWorkspace(pi);
  registerEbmIdentity(pi);

  pi.registerTool({
    name: "evidence_add",
    label: "Add Evidence",
    description: "Archive an exact line slice from a session source as a traceable Markdown evidence record.",
    promptSnippet: "Archive exact source lines as claim-linked EBM evidence",
    promptGuidelines: [
      "Use evidence_add only after reading the exact archived source window; pass the returned readable archive path as source_path with the exact offset and limit.",
      "Classify provenance honestly. Search snippets and unverified mirrors are discovery-only and cannot support a final report. Use expert_consensus for consensus/position documents rather than calling them guidelines.",
      "For secondary sources, attribute claims to that source; never rewrite a paraphrase as the target guideline's direct recommendation.",
      "Evidence can be preliminary: use confidence=low or moderate for early candidate evidence instead of delaying all evidence_add calls until the end.",
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
        "expert_consensus",
        "discovery_only",
        "other",
      ] as const)),
      confidence: Type.Optional(StringEnum(["low", "moderate", "high"] as const)),
      source_path: Type.String({ description: "Use the returned readable archive path, or a session-relative sources/read/... path" }),
      offset: Type.Integer({ minimum: 1, description: "One-based source line number, matching Pi read" }),
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
        ...(params.confidence ? { confidence: params.confidence } : {}),
        sourcePath: evidenceSourcePath(params.source_path, sessionId, sessionDir),
        offset: params.offset,
        limit: params.limit,
      }));
      const evidencePath = path.posix.join("evidence", `${node.id}.md`);
      pi.events.emit("ebm:evidence_added", { sessionId, evidenceId: node.id, path: evidencePath });
      return {
        content: [{
          type: "text",
          text: `Evidence archived: ${node.id}\nRecord: ${evidencePath}\nConfidence: ${node.confidence}`,
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
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const record = await readEvidence(sessionDir, params.evidence_id);
      const node = record.node;
      const sourceReadablePath = piReadableSessionPath(ctx.cwd, sessionId, node.sourcePath);
      const text = [
        `Evidence: ${node.id}`,
        `Claim: ${node.claim}`,
        `Relation: ${node.relation}`,
        `Provenance: ${node.provenance}`,
        `Confidence: ${node.confidence}`,
        `Citation eligible: ${node.citationEligible}`,
        `Verification: ${record.verification.ok ? "ok" : record.verification.errors.join("; ")}`,
        `Source lines: ${sourceReadablePath}:${node.lineStart}-${node.lineEnd}`,
        "",
        "Quote:",
        node.quote,
      ].join("\n");
      const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
      return {
        content: [{ type: "text", text: truncated.content }],
        details: { node, verification: record.verification, truncated: truncated.truncated },
      };
    },
  });

  registerResearchFrameTools(pi);
  if (retrievalPolicy !== "mcp_only") {
    registerWebTools(pi);
    registerPubMedTools(pi);
  }
  registerReportTools(pi);
  registerGuidelineTools(pi);
  registerCompactionArtifacts(pi);
  registerTrajectoryRecorder(pi);
  registerContextPruner(pi);
}
