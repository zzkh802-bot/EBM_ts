import { readFile } from "node:fs/promises";
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
import { addEvidence, addEvidenceFromSourceSpan, listEvidence, readEvidence } from "../tools/evidence.js";
import { EvidenceQuoteLocationError } from "../tools/evidenceLocator.js";
import { createSourceSpanId, resolveSourceId, sourceIdentityForPath } from "../tools/sourceIdentity.js";
import { registerCompactionArtifacts } from "./compactionArtifacts.js";
import { registerContextPruner } from "./contextPruner.js";
import { registerEbmIdentity } from "./ebmIdentity.js";
import { registerGuidelineTools } from "./guidelineTools.js";
import { registerPubMedTools } from "./pubmedTools.js";
import { registerReportTools } from "./reportTools.js";
import { registerResearchRoundHint } from "./researchRoundHint.js";
import { registerResearchFrameTools } from "./researchFrameTools.js";
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
  registerEbmIdentity(pi);
  registerResearchRoundHint(pi);
  registerStreamStallWatchdog(pi);

  pi.registerTool({
    name: "evidence_add",
    label: "Add Evidence",
    description: "Locate and archive a continuous verbatim quote from a session source as a traceable Markdown evidence record.",
    promptSnippet: "Archive a continuous verbatim source quote as claim-linked EBM evidence",
    promptGuidelines: [
      "Use evidence_add only after reading the archived source. Prefer a source_span_id returned by a retrieval tool because it selects already verified continuous archived text without copying; pass that span ID by itself. Otherwise pass source_id plus a minimal, sufficient, continuous verbatim quote.",
      "If quote location fails, retry with one returned source_span_id. Never repair changed numbers, drug names, wording, OCR characters, or join discontinuous passages with ellipses.",
      "Classify provenance honestly. Search snippets and unverified mirrors are discovery-only and cannot support a final report. Use expert_consensus for consensus/position documents rather than calling them guidelines.",
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
      source_path: Type.Optional(Type.String({ description: "Legacy/readable archive path. Prefer source_id when one was returned." })),
      source_id: Type.Optional(Type.String({ pattern: "^src_[a-f0-9]{16}$", description: "Stable source identity returned by read/retrieval tools" })),
      source_span_id: Type.Optional(Type.String({ pattern: "^span_[a-f0-9]{16}_[a-z0-9]+_[a-z0-9]+_[a-f0-9]{12}$", description: "Verified continuous source span returned by retrieval or a prior failed quote attempt; sufficient by itself" })),
      quote: Type.Optional(Type.String({ minLength: 6, description: "Minimal, sufficient, continuous verbatim passage; required with source_id or source_path" })),
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
      const spanMode = Boolean(params.source_span_id);
      const quoteMode = Boolean(params.quote) && Boolean(params.source_id) !== Boolean(params.source_path);
      if (!spanMode && !quoteMode) {
        throw new Error("provide source_span_id, or quote with exactly one of source_id/source_path");
      }
      if (spanMode && params.source_id && !params.source_span_id!.startsWith(`span_${params.source_id.slice(4)}_`)) {
        throw new Error("source_id does not match source_span_id");
      }
      let node;
      try {
        node = await withFileMutationQueue(indexPath, () => spanMode
          ? addEvidenceFromSourceSpan({ ...base, sourceSpanId: params.source_span_id! })
          : addEvidence({
            ...base,
            ...(params.source_id ? { sourceId: params.source_id } : { sourcePath: evidenceSourcePath(params.source_path!, sessionId, sessionDir) }),
            quote: params.quote!,
          }));
      } catch (error) {
        if (!(error instanceof EvidenceQuoteLocationError) || spanMode) throw error;
        const identity = params.source_id
          ? await resolveSourceId(sessionDir, params.source_id)
          : await sourceIdentityForPath(sessionDir, evidenceSourcePath(params.source_path!, sessionId, sessionDir));
        const source = await readFile(path.join(sessionDir, identity.path), "utf8");
        const candidates = error.candidates.map((candidate) => ({
          ...candidate,
          sourceSpanId: createSourceSpanId(identity.sourceId, source, candidate.charStart, candidate.charEnd),
        }));
        const errorCode = /匹配到\s*\d+\s*处/.test(error.message) ? "quote_ambiguous" : "quote_not_located";
        const candidateText = candidates.map((candidate, index) => [
          `候选 ${index + 1} · 第 ${candidate.lineStart}${candidate.lineEnd === candidate.lineStart ? "" : `–${candidate.lineEnd}`} 行`,
          `source_span_id: ${candidate.sourceSpanId}`,
          candidate.quote,
        ].join("\n")).join("\n\n");
        return {
          content: [{
            type: "text",
            text: [
              `Evidence was not archived (${errorCode}). Select one verified continuous candidate by retrying evidence_add with its source_span_id; do not copy or rewrite the quote.`,
              "",
              candidateText || error.message,
            ].join("\n"),
          }],
          details: { archived: false, errorCode, sourceId: identity.sourceId, documentId: identity.documentId, candidates },
        };
      }
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
