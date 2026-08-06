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
import { addEvidenceFromAnchors, listEvidence, readEvidence } from "../tools/evidence.js";
import { registerCompactionArtifacts } from "./compactionArtifacts.js";
import { registerContextPruner } from "./contextPruner.js";
import { registerEbmIdentity } from "./ebmIdentity.js";
import { registerGuidelineTools } from "./guidelineTools.js";
import { registerPubMedTools } from "./pubmedTools.js";
import { registerReportTools } from "./reportTools.js";
import { registerResearchRoundHint } from "./researchRoundHint.js";
import { registerResearchFrameTools } from "./researchFrameTools.js";
import { registerReadRegistry } from "./readRegistry.js";
import { registerSecurityGuard } from "./securityGuard.js";
import { piReadableSessionPath, piSessionDirectory, registerSessionWorkspace } from "./sessionPath.js";
import { registerStreamStallWatchdog } from "./streamStallWatchdog.js";
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
  registerReadRegistry(pi);
  registerEbmIdentity(pi);
  registerResearchRoundHint(pi);
  registerStreamStallWatchdog(pi);
  registerSecurityGuard(pi);

  pi.registerTool({
    name: "evidence_add",
    label: "Add Evidence",
    description: "Archive claim-linked evidence using a bounded read receipt or a source line range; text anchors improve location precision but do not judge clinical quality.",
    promptSnippet: "Archive claim-linked evidence with a read receipt or source line range",
    promptGuidelines: [
      "Use evidence_add only after reading the archived source. Choose one locator mode: (1) read_id plus start_text and end_text copied from that read; source_path is optional and line_start/line_end are only optional absolute-source-line narrowing hints; or (2) source_path plus line_start and line_end, with optional start_text/end_text. A read_id still requires both text anchors; line-range mode does not. If line numbers came from another candidate or read, omit them rather than combining them with this read_id. Never convert absolute source lines into read-window-relative offsets.",
      "Use short, distinctive, continuous boundary snippets from the same read. There is no fixed character count. Include a claim-specific phrase or number when useful, and avoid generic repeated markers. Layout, XML/entity, punctuation, and transport-symbol noise are normalized; wording and clinical numbers are not invented or repaired.",
      "If anchor matching fails in read_id mode, do not accept a whole-read fallback: keep the read_id, choose shorter and more distinctive start_text/end_text from that same read, or reread a narrower window. In line-range mode, the explicitly supplied line range remains the locator, so keep it narrow and never use an entire article as a convenience range.",
      "The evidence tool preserves source text and provenance; it does not judge article quality, PubMed section boundaries, or PDF table structure. Use your clinical judgment and state limitations in the report when relevant.",
      "Classify provenance honestly. An unverified mirror may be cited as an unverified mirror; never call it an official guideline. Search snippets and discovery snapshots remain discovery-only. Use expert_consensus for consensus/position documents rather than calling them guidelines.",
      "For secondary sources, attribute claims to that source; never rewrite a paraphrase as the target guideline's direct recommendation.",
      "Evidence can be preliminary: use confidence=low or moderate for early candidate evidence instead of delaying all evidence_add calls until the end.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "Complete internal evidence question" }),
      claim: Type.String({ description: "Claim interpreted from this exact source quote" }),
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
      source_path: Type.Optional(Type.String({ description: "Archive path for the source; required in line-range mode, optional when read_id is provided" })),
      read_id: Type.Optional(Type.String({ pattern: "^r[0-9]+$", description: "Read receipt ID returned by read for the same source" })),
      line_start: Type.Optional(Type.Integer({ minimum: 1, description: "Optional 1-based source line range start; with read_id it narrows within that receipt, otherwise use with source_path and line_end" })),
      line_end: Type.Optional(Type.Integer({ minimum: 1, description: "Optional 1-based source line range end; with read_id it narrows within that receipt, otherwise use with source_path and line_start" })),
      start_text: Type.Optional(Type.String({ minLength: 2, description: "Boundary text at the beginning; required with read_id, optional in line-range mode" })),
      end_text: Type.Optional(Type.String({ minLength: 2, description: "Boundary text at the end; required with read_id, optional in line-range mode" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const indexPath = path.join(sessionDir, "evidence", "EVIDENCE.md");
      const base = {
        sessionDir,
        question: params.question,
        claim: params.claim,
        relation: params.relation,
        ...(params.provenance ? { provenance: params.provenance } : {}),
        ...(params.confidence ? { confidence: params.confidence } : {}),
      };
      const node = await withFileMutationQueue(indexPath, () => addEvidenceFromAnchors({
        ...base,
        ...(params.source_path ? { sourcePath: evidenceSourcePath(params.source_path, sessionId, sessionDir) } : {}),
        ...(params.read_id ? { readId: params.read_id } : {}),
        ...(params.line_start === undefined ? {} : { lineStart: params.line_start }),
        ...(params.line_end === undefined ? {} : { lineEnd: params.line_end }),
        ...(params.start_text === undefined ? {} : { startText: params.start_text }),
        ...(params.end_text === undefined ? {} : { endText: params.end_text }),
      }));
      const evidencePath = path.posix.join("evidence", `${node.id}.md`);
      pi.events.emit("ebm:evidence_added", { sessionId, evidenceId: node.id, path: evidencePath });
      const locatorNote = node.matchMode === "line_range"
        ? "已按来源行号范围保存；文本边界未作为阻断条件。"
        : "文本边界已用于精确定位。";
      return {
        content: [{
          type: "text",
          text: `Evidence archived: ${node.id}\nRecord: ${evidencePath}\nConfidence: ${node.confidence}\nLocator: ${locatorNote}`,
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
        `Source: ${sourceReadablePath}`,
        `Source match: ${node.matchMode ?? "legacy_line_record"}`,
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
