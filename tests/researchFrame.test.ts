import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendResearchFrameScratchpad, initResearchFrame, readResearchFrame, researchFrameValidationError, updateResearchFrame } from "../src/tools/researchFrame.js";

const frameHeadings = [
  "病例 / 场景事实",
  "需要回答的临床决策",
  "循证医学子问题",
  "主张画布",
  "证据综合笔记",
  "当前判断草稿",
  "来源与证据缺口",
  "报告逻辑计划",
  "引用映射草稿",
];

const legacyFrameHeadings = [
  "Case / scenario facts",
  "Clinical decision to answer",
  "EBM sub-questions",
  "Claim canvas",
  "Evidence synthesis notes",
  "Working belief scratchpad",
  "Source and evidence gaps",
  "Report logic plan",
  "Citation map draft",
];

function validFrame(extraScratchpad = "Belief state."): string {
  return [
    "# 研究框架",
    "",
    ...legacyFrameHeadings.flatMap((heading) => [`## ${heading}`, heading === "Working belief scratchpad" ? extraScratchpad : "Free prose.", ""]),
  ].join("\n");
}

describe("research frame", () => {
  it("creates a fixed-spine EBM canvas with a free working scratchpad and reuses it", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-frame-"));
    const first = await initResearchFrame({
      sessionDir,
      userQuestion: "Can this patient receive alteplase?",
      caseFacts: "Acute ischemic stroke, 4 hours, BP 165/95 mmHg.",
      clinicalDecision: "Decide whether time and blood pressure block alteplase.",
      evidenceQuestions: ["Does BP 165/95 mmHg block alteplase in the 3-4.5h window?"],
    });
    const second = await initResearchFrame({ sessionDir, userQuestion: "Different question" });

    expect(first.path).toBe("notes/research_frame.md");
    expect(second.content).toBe(first.content);
    for (const heading of frameHeadings) expect(first.content).toContain(`## ${heading}`);
    expect(first.content).toContain("类似 POMDP 的研究状态");
    expect(first.content).toContain("Does BP 165/95 mmHg block alteplase");
  });

  it("publishes one complete frame when startup and tool initialization race", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-frame-"));
    const frames = await Promise.all(Array.from({ length: 12 }, (_, index) => initResearchFrame({
      sessionDir,
      userQuestion: index === 0 ? "Should anticoagulation be resumed?" : `Concurrent tool call ${index}`,
    })));
    const [first] = frames;

    expect(first?.content).toContain("# 研究框架");
    expect(frames.every((frame) => frame.content === first?.content)).toBe(true);
    await expect(readFile(path.join(sessionDir, "notes", "research_frame.md"), "utf8")).resolves.toBe(first?.content);
  });

  it("accepts free section content but rejects missing or reordered fixed headings", () => {
    const valid = validFrame("observation -> belief -> next action");
    expect(researchFrameValidationError(valid)).toBe("");
    expect(researchFrameValidationError(valid.replace("## Source and evidence gaps", "## Source Issues"))).toMatch(/missing sections/);
    expect(researchFrameValidationError(valid.replace("## Clinical decision to answer\nFree prose.\n\n", ""))).toMatch(/missing sections/);
  });

  it("appends scratchpad notes without rewriting the whole frame", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-frame-"));
    await initResearchFrame({ sessionDir, userQuestion: "Question" });
    const updated = await appendResearchFrameScratchpad(sessionDir, "Observation: RAG chunk supports C1. Next action: evidence_add.");

    expect(updated.content).toContain("## 当前判断草稿");
    expect(updated.content).toContain("Scratchpad update");
    expect(updated.content).toContain("RAG chunk supports C1");
    expect(researchFrameValidationError(updated.content)).toBe("");
  });

  it("updates and reads the canvas", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-frame-"));
    const content = validFrame("C1 supported by ev_x; uncertainty now lower; next action is stop retrieval.");
    const updated = await updateResearchFrame(sessionDir, content);
    const read = await readResearchFrame(sessionDir);

    expect(updated.path).toBe("notes/research_frame.md");
    expect(read.content).toContain("C1 supported");
    expect(await readFile(path.join(sessionDir, "notes", "research_frame.md"), "utf8")).toBe(read.content);
  });
});
