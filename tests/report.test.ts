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
    offset: 2,
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
    expect(saved).not.toMatch(/^---/);
    expect(saved).toContain(`Evidence ${evidence.id}`);
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${report.path}.metadata.json`), "utf8")) as { evidence_ids: string[] };
    expect(metadata.evidence_ids).toEqual([evidence.id]);
  });

  it("verifies hidden evidence mappings while keeping Markdown references human-readable", async () => {
    const { sessionDir, evidence } = await fixture();
    const report = await writeReport({
      sessionDir,
      title: "Human citation report",
      content: "# Conclusion\n\nTreatment reduced mortality [1].\n\n## 参考文献\n\n[1] Randomized trial of the intervention.",
      references: [{ number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id }],
    });

    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain("Treatment reduced mortality [1]");
    expect(saved).not.toContain(evidence.id);
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${report.path}.metadata.json`), "utf8")) as { references: Array<{ number: number; evidence_id: string }> };
    expect(metadata.references).toEqual([{ number: 1, citation: "Randomized trial of the intervention.", evidence_id: evidence.id }]);
  });

  it("auto-appends a reference section for hidden evidence mappings", async () => {
    const { sessionDir, evidence } = await fixture();
    const report = await writeReport({
      sessionDir,
      title: "Auto refs report",
      content: "# Conclusion\n\nTreatment reduced mortality [1].",
      references: [{ number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id }],
    });

    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain("## 参考文献");
    expect(saved).toContain("[1] Randomized trial of the intervention.");
    expect(saved).not.toContain(evidence.id);
  });

  it("canonicalizes common reference-heading variants from structured references", async () => {
    for (const heading of ["# 参考文献", "##    参考文献   ", "# 参考", "# 文献", "# 资料", "### References", "## Sources"]) {
      const { sessionDir, evidence } = await fixture();
      const report = await writeReport({
        sessionDir,
        title: `Refs ${heading}`,
        content: `# Conclusion\n\nTreatment reduced mortality [1].\n\n${heading}\n\n[1] Existing reference.`,
        references: [{ number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id }],
      });
      const saved = await readFile(path.join(sessionDir, report.path), "utf8");
      expect(saved.match(/\[1\]/g)?.length).toBe(2);
      expect(saved).toContain("## 参考文献\n\n[1] Randomized trial of the intervention.");
      expect(saved).not.toContain("Existing reference");
    }
  });

  it("canonicalizes model-authored one-line references even without structured references", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
    const report = await writeReport({
      sessionDir,
      title: "Model refs only",
      content: "# Conclusion\n\nEvidence gap report.\n\n参考文献\n[1] First citation. [2] Second citation. PMID: 123. [3] Third citation.",
      allowNoEvidence: true,
    });
    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain("## 参考文献\n\n[1] First citation.\n[2] Second citation. PMID: 123.\n[3] Third citation.");
  });

  it("rewrites one-line model-authored references into one entry per line", async () => {
    const { sessionDir, evidence } = await fixture();
    await writeFile(path.join(sessionDir, "sources", "read", "study2.md"), "second result", "utf8");
    const evidence2 = await addEvidence({
      sessionDir,
      question: "Does treatment reduce mortality?",
      claim: "Second source supports treatment.",
      relation: "supports",
      sourcePath: "sources/read/study2.md",
      offset: 1,
      limit: 1,
    });
    const report = await writeReport({
      sessionDir,
      title: "One-line refs report",
      content: "# Conclusion\n\nTreatment reduced mortality [1,2].\n\n参考文献\n[1] Old one. [2] Old two.",
      references: [
        { number: 1, citation: "Randomized trial one.", evidenceId: evidence.id },
        { number: 2, citation: "Randomized trial two.", evidenceId: evidence2.id },
      ],
    });
    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain("## 参考文献\n\n[1] Randomized trial one.\n[2] Randomized trial two.");
    expect(saved).not.toContain("Old one. [2] Old two.");
  });

  it("does not treat non-reference source-context headings as reference sections", async () => {
    const { sessionDir, evidence } = await fixture();
    const report = await writeReport({
      sessionDir,
      title: "Guideline heading report",
      content: "# Conclusion\n\nTreatment reduced mortality [1].\n\n# 指南\n\nDiscussed guideline context.",
      references: [{ number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id }],
    });
    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain("# 指南");
    expect(saved).toContain("## 参考文献");
    expect(saved).toContain("[1] Randomized trial of the intervention.");
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
      offset: 1,
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
