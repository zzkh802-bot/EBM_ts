import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const matches = RESEARCH_FRAME_SECTIONS.map((section) => ({ section, match: headingPattern(section).exec(content) }));
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
  return normalizeMarkdown(`# Research Frame

This is the working canvas for the current EBM question. The section headings and order are fixed; section content is free Markdown. Do not turn this into a final report, search log, or TodoList.

## Case / scenario facts

${input.caseFacts?.trim() || `- User question: ${input.userQuestion.trim()}\n- Known patient/scenario facts: 未填写\n- Unknown facts that may change the decision: 未填写`}

## Clinical decision to answer

${input.clinicalDecision?.trim() || "Clarify the concrete decision the user needs, and state what kind of answer would change management or interpretation."}

## EBM sub-questions

<!-- Keep only decision-changing questions. They should be complete natural-language EBM questions, not source names. -->

${listLines(input.evidenceQuestions).join("\n")}

## Claim canvas

<!-- Each claim should be specific enough to be supported, limited, or refuted by evidence. Add evidence early. -->

| Claim ID | Claim to adjudicate | Status | Evidence refs | Applicability / limits |
| --- | --- | --- | --- | --- |
| C1 |  | unresolved |  |  |

## Evidence synthesis notes

<!-- Write reasoning, not source lists. Explain how evidence changes each claim and how claims combine. -->

## Working belief scratchpad

<!-- Free-form scratchpad for POMDP-like research state. Track current belief, observations, uncertainty, actions considered, why one next observation is most valuable, and stop/continue conditions. This is not final report prose. -->

## Source and evidence gaps

<!-- Missing patient facts, inaccessible sources, indirectness, conflicts, weak provenance, or evidence quality limits. -->

## Report logic plan

<!-- Human-readable argument order: opening answer -> sub-question reasoning -> synthesis -> limitations -> references. -->

## Citation map draft

<!-- Numbered citations for the final report. Raw ev_ IDs are internal working notes only and should be passed to report_write.references, not shown in final Markdown. -->

| Ref | Real citation | Evidence ID | Supports claim |
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
    try {
      await writeFile(abs, content, { encoding: "utf8", flag: "wx" });
      return { path: FRAME_PATH, content };
    } catch (writeError) {
      // The server prepares the canvas as the session starts, while the agent may
      // invoke this tool at the same time. In that race, reuse the winner's file.
      if (!(writeError instanceof Error && "code" in writeError && writeError.code === "EEXIST")) throw writeError;
      return { path: FRAME_PATH, content: await readFile(abs, "utf8") };
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
  const heading = "## Working belief scratchpad";
  const nextHeading = "## Source and evidence gaps";
  const start = current.content.indexOf(heading);
  const end = current.content.indexOf(nextHeading);
  if (start < 0 || end < 0 || end <= start) throw new Error("research_frame scratchpad section is missing or reordered");
  const insertAt = end;
  const timestamp = formatBeijingTimestamp();
  const entry = `\n### Scratchpad update ${timestamp}\n\n${normalizeMarkdown(note)}\n`;
  const content = `${current.content.slice(0, insertAt).replace(/\s*$/, "\n")}${entry}\n${current.content.slice(insertAt)}`;
  return updateResearchFrame(sessionDir, content);
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
