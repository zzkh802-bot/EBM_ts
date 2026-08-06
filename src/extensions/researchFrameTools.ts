import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendResearchFrameScratchpad, initResearchFrame, readResearchFrame, updateResearchFrame } from "../tools/researchFrame.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

export function registerResearchFrameTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  if (process.env.EBM_RESEARCH_FRAME === "0") return;

  pi.registerTool({
    name: "research_frame_init",
    label: "建立研究框架",
    description: "创建或读取一个稳定的 Markdown 研究画布；章节标题固定，章节内容可自由编辑。",
    promptSnippet: "建立包含子问题、主张、早期证据、缺口和报告逻辑的结构化循证画布",
    promptGuidelines: [
      "对于非简单的循证问题，在广泛检索前尽早建立研究框架。",
      "将研究框架作为可反复修改的工作画布，而不是最终报告。章节标题和顺序固定，章节内容可自由使用 Markdown。",
      "当可追溯来源直接支持某条主张时尽早登记证据，并在框架中记录，不要等到最后才处理。",
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
        content: [{ type: "text", text: `研究框架：${piReadableSessionPath(ctx.cwd, sessionId, frame.path)}\n请随着主张和证据的变化更新此画布。` }],
        details: frame,
      };
    },
  });

  pi.registerTool({
    name: "research_frame_read",
    label: "读取研究框架",
    description: "读取当前的循证研究画布。",
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
    label: "追加判断草稿",
    description: "在“当前判断草稿”中追加观察、判断或行动记录，不必重写整个研究框架。",
    promptSnippet: "在观察改变当前判断或下一步行动后，追加一条类似 POMDP 的研究状态记录",
    promptGuidelines: [
      "在检索、evidence_add、发现冲突或作出停止 / 继续决定后，用它记录轻量更新。",
      "不要粘贴长篇原文；概括观察、判断变化、不确定性和下一步最有价值的行动。",
    ],
    parameters: Type.Object({ note: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const frame = await appendResearchFrameScratchpad(piSessionDirectory(ctx.cwd, sessionId), params.note);
      return { content: [{ type: "text", text: `判断草稿已追加：${piReadableSessionPath(ctx.cwd, sessionId, frame.path)}` }], details: frame };
    },
  });

  pi.registerTool({
    name: "research_frame_update",
    label: "更新研究框架",
    description: "在主张、证据、缺口或报告逻辑发生变化后覆盖当前循证研究画布。固定章节必须保留且顺序不变。",
    promptGuidelines: [
      "严格保留固定章节标题；只更新子问题、主张状态、证据引用、缺口和报告计划等章节内容。",
      "最终报告使用编号引用；原始 ev_ ID 只作为内部映射记录。",
    ],
    parameters: Type.Object({ markdown: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const frame = await updateResearchFrame(piSessionDirectory(ctx.cwd, sessionId), params.markdown);
      return { content: [{ type: "text", text: `研究框架已更新：${piReadableSessionPath(ctx.cwd, sessionId, frame.path)}` }], details: frame };
    },
  });
}
