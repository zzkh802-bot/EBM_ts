import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendResearchFrameScratchpad, initResearchFrame, readResearchFrame, updateResearchFrame } from "../tools/researchFrame.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

export function registerResearchFrameTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  if (process.env.EBM_RESEARCH_FRAME === "0") return;

  pi.registerTool({
    name: "research_frame_init",
    label: "Initialize Research Frame",
    description: "Create or read a stable Markdown research canvas with fixed section headings and freely editable section content.",
    promptSnippet: "Create a structured EBM canvas for sub-questions, claims, early evidence, gaps, and report logic",
    promptGuidelines: [
      "Use early for non-trivial EBM questions before broad retrieval.",
      "Keep the frame as a revisable canvas, not a final report. Section headings and order are fixed; section content is free Markdown.",
      "Add evidence early when a traceable source directly supports a claim; record the evidence in the frame rather than waiting until the end.",
    ],
    parameters: Type.Object({
      user_question: Type.String({ minLength: 2 }),
      case_facts: Type.Optional(Type.String()),
      clinical_decision: Type.Optional(Type.String()),
      evidence_questions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const frame = await initResearchFrame({
        sessionDir,
        userQuestion: params.user_question,
        ...(params.case_facts ? { caseFacts: params.case_facts } : {}),
        ...(params.clinical_decision ? { clinicalDecision: params.clinical_decision } : {}),
        ...(params.evidence_questions ? { evidenceQuestions: params.evidence_questions } : {}),
      });
      return {
        content: [{ type: "text", text: `Research frame: ${piReadableSessionPath(ctx.cwd, sessionId, frame.path)}\nUpdate this canvas as claims/evidence evolve.` }],
        details: frame,
      };
    },
  });

  pi.registerTool({
    name: "research_frame_read",
    label: "Read Research Frame",
    description: "Read the current EBM research canvas.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const frame = await readResearchFrame(piSessionDirectory(ctx.cwd, sessionId));
      const truncated = truncateHead(frame.content, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
      return { content: [{ type: "text", text: truncated.content }], details: { ...frame, truncated: truncated.truncated } };
    },
  });

  pi.registerTool({
    name: "research_frame_scratchpad_append",
    label: "Append Research Scratchpad",
    description: "Append a free-form observation/belief/action note to the Working belief scratchpad without rewriting the whole research frame.",
    promptSnippet: "Append a POMDP-like research-state note after an observation changes belief or next action",
    promptGuidelines: [
      "Use this for lightweight updates after retrieval, evidence_add, conflicts, or stop/continue decisions.",
      "Do not paste long source text; summarize the observation, belief update, uncertainty, and next best action.",
    ],
    parameters: Type.Object({ note: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const frame = await appendResearchFrameScratchpad(piSessionDirectory(ctx.cwd, sessionId), params.note);
      return { content: [{ type: "text", text: `Research scratchpad appended: ${piReadableSessionPath(ctx.cwd, sessionId, frame.path)}` }], details: frame };
    },
  });

  pi.registerTool({
    name: "research_frame_update",
    label: "Update Research Frame",
    description: "Overwrite the current EBM research canvas after claims, evidence, gaps, or report logic change. Fixed headings must remain present and in order.",
    promptGuidelines: [
      "Preserve the fixed section headings exactly; update only section content such as sub-questions, claim statuses, evidence refs, gaps, and report plan.",
      "Use numbered report citations for the final plan and keep raw ev_ IDs as internal mapping notes only.",
    ],
    parameters: Type.Object({ markdown: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const frame = await updateResearchFrame(piSessionDirectory(ctx.cwd, sessionId), params.markdown);
      return { content: [{ type: "text", text: `Research frame updated: ${piReadableSessionPath(ctx.cwd, sessionId, frame.path)}` }], details: frame };
    },
  });
}
