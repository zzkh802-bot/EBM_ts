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
    label: "生成正式报告",
    description: "逐一核验引用的证据记录及其归档来源后，写入 Markdown 循证报告。",
    promptSnippet: "保存一份证据引用已核验的正式 Markdown 报告",
    promptGuidelines: [
      "In the report body, cite evidence with numbered references like [1] or [1,2], not raw ev_ identifiers.",
      "Pass the hidden evidence mapping through the references parameter: citation numbers represent bibliographic sources. The same number may appear multiple times only when the citation text is the same, to map one source to multiple supporting evidence_id records. Do not use the same number for different citations.",
      "When references is provided, you may omit the Markdown reference list; the tool will append a renderable numbered reference section. Every reference number must be used by at least one decision-relevant body citation, and every body citation [n] must exist in references.",
      "Before calling report_write, run a citation preflight mentally: collect all body citation numbers before the reference section and all references[].number values as sets; the two sets must be identical. Duplicate reference numbers are allowed only for identical citation text mapping to additional evidence_id records.",
      "Before calling report_write, run a non-blocking clinical preflight: re-check case facts against the user's original information; keep unspecified facts unknown; recalculate any stated clinical score from its listed components; make patient-level eligibility and safety conclusions conditional on all required facts; and omit or explicitly qualify time-sensitive claims that lack a current authoritative source.",
      "Write an argued but concise EBM report: decompose the user's decision into sub-questions and claims, integrate evidence into reasoning, cite each key claim with numbered references, and avoid source-by-source lists or unnecessary method-log detail.",
      "报告标题、正文和面向用户的参考文献说明默认使用自然中文；仅在药名、研究名称、缩写或必要的原文短语中保留英文。除非用户明确要求其他语言，不要输出英文报告。",
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
              `会话工作区：${["data", "sessions", path.basename(sessionDir)].join("/")}`,
              `已写入并核验正式报告：${readableReportPath}`,
              "这已经是最终核验报告；只有 report_write 保存了未核验的 reports/drafts/*.draft.md 草稿时，才需要调用 report_finalize。",
              `证据记录：${report.evidenceIds.length}`,
              `SHA-256：${report.sha256}`,
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
              `报告核验失败：${message}`,
              `未核验草稿已保存，可在此处编辑：${readableDraftPath}`,
              "这不是已核验的正式报告，也没有证据元数据。请用 read/edit 修复局部内容，准备好后再次调用 report_write。",
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
              `已从草稿核验并发布报告：${piReadableSessionPath(ctx.cwd, sessionId, draft.rel)}`,
              `正式报告：${readableReportPath}`,
              `证据记录：${report.evidenceIds.length}`,
              `SHA-256：${report.sha256}`,
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
