import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeMarkdown } from "./markdown.js";
import { formatBeijingTimestamp } from "./time.js";

export type ResearchFrameInput = {
  sessionDir: string;
  userQuestion: string;
  caseFacts?: string;
  clinicalDecision?: string;
  evidenceQuestions?: string[];
};

export type ResearchFrameRecord = {
  path: string;
  content: string;
};

const FRAME_PATH = path.posix.join("notes", "research_frame.md");

export const RESEARCH_FRAME_SECTIONS = [
  "病例 / 场景事实",
  "需要回答的临床决策",
  "循证医学子问题",
  "主张画布",
  "证据综合笔记",
  "当前判断草稿",
  "来源与证据缺口",
  "报告逻辑计划",
  "引用映射草稿",
] as const;

// Frames created before the localization change keep their English headings.
// Accept them so an existing session can still be updated, while all new
// frames use the Chinese canvas above.
const LEGACY_RESEARCH_FRAME_SECTIONS = [
  "Case / scenario facts",
  "Clinical decision to answer",
  "EBM sub-questions",
  "Claim canvas",
  "Evidence synthesis notes",
  "Working belief scratchpad",
  "Source and evidence gaps",
  "Report logic plan",
  "Citation map draft",
] as const;

function headingPattern(heading: string): RegExp {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s+${escaped}(?:\\s*(?:（[^）\\n]*）|\\([^\\)\\n]*\\)|【[^】\\n]*】|\\[[^\\]\\n]*\\]))?\\s*$`, "m");
}

export function researchFrameValidationError(content: string): string {
  const matches = RESEARCH_FRAME_SECTIONS.map((section, index) => ({
    section,
    match: findSectionHeading(content, index),
  }));
  const missing = matches.filter((item) => !item.match).map((item) => item.section);
  if (missing.length) {
    return `research_frame update rejected: keep the fixed canvas spine; missing sections: ${missing.join(", ")}. Required order: ${RESEARCH_FRAME_SECTIONS.join(" → ")}.`;
  }
  const positions = matches.map((item) => item.match!.index);
  if (positions.some((position, index) => index > 0 && position < positions[index - 1]!)) {
    return `research_frame update rejected: fixed section order cannot change. Required order: ${RESEARCH_FRAME_SECTIONS.join(" → ")}.`;
  }
  return "";
}

function listLines(items?: string[]): string[] {
  const clean = (items ?? []).map((item) => item.trim()).filter(Boolean);
  return clean.length ? clean.map((item) => `- ${item}`) : ["1. "];
}

function frameTemplate(input: Omit<ResearchFrameInput, "sessionDir">): string {
  return normalizeMarkdown(`# 研究框架

这是当前循证问题的工作画布。章节标题和顺序固定，章节内容可以使用 Markdown 自由填写。不要把它写成最终报告、检索日志或 TodoList。

## 病例 / 场景事实

${input.caseFacts?.trim() || `- 用户问题：${input.userQuestion.trim()}\n- 已知患者 / 场景事实：未填写\n- 可能改变决策的未知事实：未填写`}

## 需要回答的临床决策

${input.clinicalDecision?.trim() || "明确用户需要作出的具体决策，并说明什么样的答案会改变处理方案或解释。"}

## 循证医学子问题

<!-- 只保留会改变决策的问题。问题应是完整的自然语言循证问题，而不是来源名称。 -->

${listLines(input.evidenceQuestions).join("\n")}

## 主张画布

<!-- 每条主张都应足够具体，能够被证据支持、限定或反驳。尽早添加证据。 -->

| 主张 ID | 待裁决主张 | 状态 | 证据引用 | 适用性 / 局限性 |
| --- | --- | --- | --- | --- |
| C1 |  | 未解决 |  |  |

## 证据综合笔记

<!-- 记录推理而不是来源清单。说明证据如何改变每条主张，以及各条主张如何合并。 -->

## 当前判断草稿

<!-- 用于记录类似 POMDP 的研究状态。跟踪当前判断、观察、不确定性、考虑过的行动、下一条观察为何最有价值，以及停止/继续条件。这不是最终报告正文。 -->

## 来源与证据缺口

<!-- 记录缺失的患者事实、无法访问的来源、间接性、冲突、来源链薄弱或证据质量限制。 -->

## 报告逻辑计划

<!-- 用人类可读的顺序组织论证：开头答案 → 子问题推理 → 综合 → 局限性 → 参考文献。 -->

## 引用映射草稿

<!-- 为最终报告准备编号引用。原始 ev_ ID 仅用于内部工作记录，应传给 report_write.references，不要显示在最终 Markdown 中。 -->

| 编号 | 正式引用 | 证据 ID | 支持的主张 |
| --- | --- | --- | --- |
`);
}

export async function initResearchFrame(input: ResearchFrameInput): Promise<ResearchFrameRecord> {
  const abs = path.join(input.sessionDir, FRAME_PATH);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    const existing = await readFile(abs, "utf8");
    return { path: FRAME_PATH, content: existing };
  } catch {
    const content = `${frameTemplate(input)}\n`;
    const error = researchFrameValidationError(content);
    if (error) throw new Error(error);
    const temporary = `${abs}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, "utf8");
    try {
      await link(temporary, abs);
      return { path: FRAME_PATH, content };
    } catch (writeError) {
      // The server prepares the canvas as the session starts, while the agent may
      // invoke this tool at the same time. In that race, reuse the winner's file.
      if (!(writeError instanceof Error && "code" in writeError && writeError.code === "EEXIST")) throw writeError;
      return { path: FRAME_PATH, content: await readFile(abs, "utf8") };
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export async function readResearchFrame(sessionDir: string): Promise<ResearchFrameRecord> {
  const abs = path.join(sessionDir, FRAME_PATH);
  const content = await readFile(abs, "utf8");
  return { path: FRAME_PATH, content };
}

export async function appendResearchFrameScratchpad(sessionDir: string, note: string): Promise<ResearchFrameRecord> {
  const current = await readResearchFrame(sessionDir).catch(async () => initResearchFrame({ sessionDir, userQuestion: "Unspecified EBM question" }));
  const scratchpad = findSectionHeading(current.content, 5);
  const gaps = findSectionHeading(current.content, 6);
  const start = scratchpad?.index ?? -1;
  const end = gaps?.index ?? -1;
  if (start < 0 || end < 0 || end <= start) throw new Error("research_frame scratchpad section is missing or reordered");
  const insertAt = end;
  const timestamp = formatBeijingTimestamp();
  const entry = `\n### Scratchpad update ${timestamp}\n\n${normalizeMarkdown(note)}\n`;
  const content = `${current.content.slice(0, insertAt).replace(/\s*$/, "\n")}${entry}\n${current.content.slice(insertAt)}`;
  return updateResearchFrame(sessionDir, content);
}

function findSectionHeading(content: string, index: number): { section: string; index: number } | null {
  const candidates: string[] = [];
  const localized = RESEARCH_FRAME_SECTIONS[index];
  const legacy = LEGACY_RESEARCH_FRAME_SECTIONS[index];
  if (localized) candidates.push(localized);
  if (legacy) candidates.push(legacy);
  const matches = candidates
    .filter((section): section is string => Boolean(section))
    .map((section) => ({ section, index: headingPattern(section).exec(content)?.index ?? -1 }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index);
  return matches[0] ?? null;
}

export async function updateResearchFrame(sessionDir: string, content: string): Promise<ResearchFrameRecord> {
  const normalized = `${normalizeMarkdown(content)}\n`;
  const error = researchFrameValidationError(normalized);
  if (error) throw new Error(error);
  const abs = path.join(sessionDir, FRAME_PATH);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, normalized, "utf8");
  return { path: FRAME_PATH, content: normalized };
}
