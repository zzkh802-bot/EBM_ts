import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeReport, writeReportDraft, type ReportNormalization } from "../tools/report.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function safeDraftPath(sessionDir: string, draftPath: string): { rel: string; abs: string } {
  const normalized = draftPath.replace(/^data\/sessions\/[^/]+\//, "").replace(/^\/+/, "");
  if (path.isAbsolute(normalized) || normalized.includes("..")) throw new Error("draft_path must be a relative session path");
  if (!/^reports\/drafts\/.+\.draft\.md$/.test(normalized)) throw new Error("draft_path must point to reports/drafts/*.draft.md");
  return { rel: normalized, abs: path.join(sessionDir, normalized) };
}

function normalizationMessages(normalization: ReportNormalization): string[] {
  if (!normalization.contentChanged && !normalization.referencesRebuilt) {
    return ["报告内容未被工具改写。"];
  }
  const messages = ["报告已由工具规范化；后续请以已写入文件内容为准。"];
  if (normalization.referencesRebuilt) {
    messages.push("参考文献列表已根据 references 参数重建。");
  }
  if (normalization.referenceNumbersCompacted) {
    messages.push(`引用编号已重排：${normalization.referenceNumberMap.map(({ from, to }) => `[${from}]→[${to}]`).join("、")}`);
  }
  return messages;
}

export function registerReportTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  pi.registerTool({
    name: "report_write",
    label: "生成正式报告",
    description: "逐一核验引用的证据记录及其归档来源后，写入 Markdown 循证报告。",
    promptSnippet: "保存一份证据引用已核验的正式 Markdown 报告",
    promptGuidelines: [
      "正文使用 [1]、[1,2] 等编号引用，不要把 ev_ ID 写进用户可见正文；把 ev_ ID 放在 references 参数中。",
      "references 中的 number、citation 和 evidence_id 只负责建立可回溯映射；提供 references 后可以省略正文末尾的参考文献列表，工具会生成它。",
      "工具可能规范化 Markdown、重建参考文献并压缩不连续的引用编号；调用成功后以工具返回的正式报告路径和变更摘要为准，不要假设原始 markdown 未被改写。",
      "写作前做一个轻量检查：回答用户真正的临床决策，保留未知事实，说明证据的适用边界和不确定性；不要为了满足关键词或固定模板扩展检索。",
      "报告应围绕少量能改变决策的子问题组织论证：主张 → 证据 → 证据限制 → 对当前问题的含义。不要写成检索日志或逐篇文献清单。",
      "证据的文章质量、摘要范围和 PDF 排版由模型结合上下文判断；工具只核验来源和定位完整性。非官方镜像可以引用，但必须如实标注来源性质，不能写成官方指南。",
      "报告标题、正文和面向用户的参考文献说明默认使用自然中文；仅在药名、研究名称、缩写或必要的原文短语中保留英文。除非用户明确要求其他语言，不要输出英文报告。",
      "只有在报告明确说明证据缺口、且没有把缺口写成已证实结论时，才使用 allow_no_evidence。",
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
              `会话工作区：${["data", "sessions", path.basename(sessionDir)].join("/")}`,
              `已写入并核验正式报告：${readableReportPath}`,
              "这已经是最终核验报告；只有 report_write 保存了未核验的 reports/drafts/*.draft.md 草稿时，才需要调用 report_finalize。",
              `证据记录：${report.evidenceIds.length}`,
              `SHA-256：${report.sha256}`,
              ...normalizationMessages(report.normalization),
            ].join("\n"),
          }],
          details: { ...report, readablePath: readableReportPath, sessionWorkspace: ["data", "sessions", path.basename(sessionDir)].join("/") },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const draft = await writeReportDraft(input, message);
        const readableDraftPath = piReadableSessionPath(ctx.cwd, sessionId, draft.path);
        return {
          isError: true,
          content: [{
            type: "text",
            text: [
              `报告核验失败：${message}`,
              `未核验草稿已保存，可在此处编辑：${readableDraftPath}`,
              "这不是已核验的正式报告，也没有证据元数据。请用 read/edit 修复局部内容，准备好后再次调用 report_write。",
              ...normalizationMessages(draft.normalization),
            ].join("\n"),
          }],
          details: { verified: false, draft: { ...draft, readablePath: readableDraftPath }, error: message },
        };
      }
    },
  });

  pi.registerTool({
    name: "report_finalize",
    label: "核验并发布报告",
    description: "读取已编辑的 reports/drafts/*.draft.md 草稿，核验证据引用后发布为正式 Markdown 循证报告。",
    promptSnippet: "无需重新发送整篇 Markdown，直接核验并发布本地编辑过的未核验草稿",
    promptGuidelines: [
      "仅当 report_write 已保存未核验草稿时使用 report_finalize；普通成功的 report_write 不需要再次调用它。",
      "使用 report_write 返回的 draft_path 和最新 references。先修复工具报告的具体完整性问题，再用同一草稿重试，不要重新检索整篇来源。",
      "发布结果可能包含 Markdown 规范化或引用编号重排；以工具返回的正式报告文件为最终版本。",
      "临床适用性、冲突和不确定性由模型结合证据判断并在报告中说明，不由关键词规则自动判定。",
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
              `已从草稿核验并发布报告：${piReadableSessionPath(ctx.cwd, sessionId, draft.rel)}`,
              `正式报告：${readableReportPath}`,
              `证据记录：${report.evidenceIds.length}`,
              `SHA-256：${report.sha256}`,
              ...normalizationMessages(report.normalization),
            ].join("\n"),
          }],
          details: { verified: true, ...report, readablePath: readableReportPath, draftPath: draft.rel },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{
            type: "text",
            text: [
              `报告发布失败：${message}`,
              `请继续编辑同一份草稿：${piReadableSessionPath(ctx.cwd, sessionId, draft.rel)}`,
              "用 edit 修复局部问题后，使用相同的 draft_path 和修正后的 references 再次调用 report_finalize。",
            ].join("\n"),
          }],
          details: { verified: false, draftPath: draft.rel, error: message },
        };
      }
    },
  });
}
