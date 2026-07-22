import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addEvidence } from "../src/tools/evidence.js";
import { writeReport } from "../src/tools/report.js";

async function fixture() {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
  await mkdir(path.join(sessionDir, "sources", "read"), { recursive: true });
  await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "trial result\nreduced mortality", "utf8");
  const evidence = await addEvidence({
    sessionDir,
    question: "Does treatment reduce mortality?",
    claim: "Treatment reduced mortality.",
    relation: "supports",
    sourcePath: "sources/read/study.md",
    offset: 1,
    limit: 1,
  });
  return { sessionDir, evidence };
}

describe("verified Markdown reports", () => {
  it("writes a report only after verifying every referenced evidence record", async () => {
    const { sessionDir, evidence } = await fixture();
    const report = await writeReport({
      sessionDir,
      title: "Mortality evidence report",
      content: `# Conclusion\n\nTreatment reduced mortality [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    });

    expect(report.evidenceIds).toEqual([evidence.id]);
    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain(`evidence_ids: ["${evidence.id}"]`);
    expect(saved).toContain(`Evidence ${evidence.id}`);
  });

  it("uses semantic report filenames without hash suffixes", async () => {
    const { sessionDir, evidence } = await fixture();
    const content = `# 结论\n\n治疗降低死亡率 [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`;
    const first = await writeReport({ sessionDir, title: "高血压治疗循证报告 2025", content });
    const duplicate = await writeReport({ sessionDir, title: "高血压治疗循证报告 2025", content });
    const revised = await writeReport({ sessionDir, title: "高血压治疗循证报告 2025", content: `${content}\n\n更新说明。` });
    expect(first.path).toBe("reports/高血压治疗循证报告-2025.md");
    expect(duplicate.path).toBe(first.path);
    expect(revised.path).toBe("reports/高血压治疗循证报告-2025-2.md");
  });

  it("rejects unknown or source-mismatched evidence references", async () => {
    const { sessionDir, evidence } = await fixture();
    await expect(writeReport({
      sessionDir,
      title: "Unknown",
      content: "Unsupported [Evidence ev_0000000000000000](../evidence/ev_0000000000000000.md).",
    })).rejects.toThrow(/not found|ENOENT/);

    await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "trial result\nchanged result", "utf8");
    await expect(writeReport({
      sessionDir,
      title: "Stale",
      content: `Stale [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    })).rejects.toThrow(/verification failed/);
  });

  it("rejects citation-ineligible discovery or unverified-mirror evidence", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
    await writeFile(path.join(sessionDir, "mirror.md"), "Unverified guideline recommendation.", "utf8");
    const evidence = await addEvidence({
      sessionDir,
      question: "What does the guideline recommend?",
      claim: "The guideline recommends treatment.",
      relation: "supports",
      provenance: "guideline_mirror_unverified",
      sourcePath: "mirror.md",
      offset: 0,
      limit: 1,
    });
    await expect(writeReport({
      sessionDir,
      title: "Unverified recommendation",
      content: `Claim [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    })).rejects.toThrow(/not citation eligible/);
  });

  it("requires explicit opt-in for an evidence-gap report", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
    await expect(writeReport({ sessionDir, title: "Gap", content: "No eligible studies found." })).rejects.toThrow(/no evidence references/);
    const report = await writeReport({ sessionDir, title: "Gap", content: "No eligible studies found.", allowNoEvidence: true });
    expect(report.evidenceIds).toEqual([]);
  });
});
