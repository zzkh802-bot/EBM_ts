import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addEvidence } from "../src/tools/evidence.js";
import { writeReport, writeReportDraft } from "../src/tools/report.js";

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
    quote: "reduced mortality",
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
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${report.path}.metadata.json`), "utf8")) as { references: Array<{ number: number; evidence_id: string; evidence_ids: string[] }> };
    expect(metadata.references).toEqual([{ number: 1, citation: "Randomized trial of the intervention.", evidence_ids: [evidence.id], evidence_id: evidence.id }]);
  });

  it("deduplicates repeated identical hidden reference mappings", async () => {
    const { sessionDir, evidence } = await fixture();
    const report = await writeReport({
      sessionDir,
      title: "Duplicate refs report",
      content: "# Conclusion\n\nTreatment reduced mortality [1].",
      references: [
        { number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id },
        { number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id },
      ],
    });

    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved.match(/^1\. \[1\]/gm)?.length).toBe(1);
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${report.path}.metadata.json`), "utf8")) as { references: Array<{ number: number; evidence_id: string; evidence_ids: string[] }> };
    expect(metadata.references).toEqual([{ number: 1, citation: "Randomized trial of the intervention.", evidence_ids: [evidence.id], evidence_id: evidence.id }]);
  });

  it("allows one bibliographic reference to map to multiple evidence records", async () => {
    const { sessionDir, evidence } = await fixture();
    await writeFile(path.join(sessionDir, "sources", "read", "study2.md"), "second result", "utf8");
    const evidence2 = await addEvidence({
      sessionDir,
      question: "Does treatment reduce mortality?",
      claim: "Second source supports treatment.",
      relation: "supports",
      sourcePath: "sources/read/study2.md",
      quote: "second result",
    });

    const report = await writeReport({
      sessionDir,
      title: "Grouped reference report",
      content: "# Conclusion\n\nTreatment reduced mortality and adverse outcomes [1].",
      references: [
        { number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id },
        { number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence2.id },
      ],
    });

    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved.match(/^1\. \[1\]/gm)?.length).toBe(1);
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${report.path}.metadata.json`), "utf8")) as { references: Array<{ number: number; evidence_ids: string[]; evidence_id: string }> };
    const sortedEvidenceIds = [evidence.id, evidence2.id].sort();
    expect(metadata.references).toEqual([{ number: 1, citation: "Randomized trial of the intervention.", evidence_ids: sortedEvidenceIds, evidence_id: sortedEvidenceIds[0] }]);
  });

  it("automatically merges different numbers for the same citation", async () => {
    const { sessionDir, evidence } = await fixture();
    await writeFile(path.join(sessionDir, "sources", "read", "study2.md"), "second result", "utf8");
    const evidence2 = await addEvidence({
      sessionDir,
      question: "Does treatment reduce mortality?",
      claim: "Second source supports treatment.",
      relation: "supports",
      sourcePath: "sources/read/study2.md",
      quote: "second result",
    });

    const report = await writeReport({
      sessionDir,
      title: "Auto merged citation report",
      content: "# Conclusion\n\nTreatment reduced mortality [1] and adverse outcomes [2].",
      references: [
        { number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id },
        { number: 2, citation: "Randomized trial of the intervention.", evidenceId: evidence2.id },
      ],
    });

    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toContain("Treatment reduced mortality [1] and adverse outcomes [1].");
    expect(saved.match(/^1\. \[1\]/gm)).toHaveLength(1);
    expect(saved).not.toMatch(/^2\. \[2\]/m);
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${report.path}.metadata.json`), "utf8")) as { references: Array<{ number: number; evidence_ids: string[] }> };
    expect(metadata.references).toEqual([{ number: 1, citation: "Randomized trial of the intervention.", evidence_ids: [evidence.id, evidence2.id].sort(), evidence_id: [evidence.id, evidence2.id].sort()[0] }]);
  });

  it("rejects duplicate reference numbers with conflicting citations", async () => {
    const { sessionDir, evidence } = await fixture();
    await writeFile(path.join(sessionDir, "sources", "read", "study2.md"), "second result", "utf8");
    const evidence2 = await addEvidence({
      sessionDir,
      question: "Does treatment reduce mortality?",
      claim: "Second source supports treatment.",
      relation: "supports",
      sourcePath: "sources/read/study2.md",
      quote: "second result",
    });
    await expect(writeReport({
      sessionDir,
      title: "Conflicting duplicate refs report",
      content: "# Conclusion\n\nTreatment reduced mortality [1].",
      references: [
        { number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id },
        { number: 1, citation: "Another source.", evidenceId: evidence2.id },
      ],
    })).rejects.toThrow(/duplicate reference number 1 has conflicting citations/);
  });

  it("requires provided references to be cited in the report body", async () => {
    const { sessionDir, evidence } = await fixture();
    await expect(writeReport({
      sessionDir,
      title: "Source list report",
      content: "# Conclusion\n\nTreatment appears beneficial based on the verified evidence source list below.",
      references: [{ number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id }],
    })).rejects.toThrow(/no numbered citations/);
  });

  it("saves unverified Markdown drafts with attempted references but no JSON sidecar", async () => {
    const { sessionDir, evidence } = await fixture();
    const draft = await writeReportDraft({
      sessionDir,
      title: "Draft report",
      content: "# Conclusion\n\nTreatment appears beneficial.",
      references: [{ number: 1, citation: "Randomized trial of the intervention.", evidenceId: evidence.id }],
    }, "report body has no numbered citations");

    expect(draft.path).toMatch(/reports\/drafts\/draft-report\.draft\.md$/);
    const saved = await readFile(path.join(sessionDir, draft.path), "utf8");
    expect(saved).toContain("## 参考文献");
    expect(saved).toContain("这里只是草稿预览");
    expect(saved).toContain("1. [1] Randomized trial of the intervention.");
    await expect(readFile(path.join(sessionDir, `${draft.path}.metadata.json`), "utf8")).rejects.toThrow();
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
      expect(saved).toContain("## 参考文献\n\n1. [1] Randomized trial of the intervention.");
      expect(saved).not.toContain("Existing reference");
    }
  });

  it("canonicalizes long AML-style model-authored one-line references", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
    const content = `# Report\n\nBody.\n\n参考文献\n[1] Mayer RJ, Davis RB, Schiffer CA, et al. Intensive postremission chemotherapy in adults with acute myeloid leukemia. N Engl J Med. 1994;331:896-903. [2] Büchner T, Berdel WE, Schoch C, et al. High-dose cytarabine consolidation with or without additional amsacrine and mitoxantrone in acute myeloid leukemia: results of the prospective randomized AML2003 trial. J Clin Oncol. 2013;31(16):1968-76. PMID: 23630210. [3] Burnett AK, Russell NH, Hills RK, et al. Optimization of chemotherapy for younger patients with acute myeloid leukemia: results of the medical research council AML15 trial. J Clin Oncol. 2013;31(27):3360-8. PMID: 23940227. [4] Bradstock KF, Matthews JP, Lowenthal RM, et al. A randomized trial of high-versus conventional-dose cytarabine in consolidation chemotherapy for adult de novo acute myeloid leukemia in first remission after induction therapy containing high-dose cytarabine. Blood. 2005;105(2):481-8. PMID: 15213095.`;
    const report = await writeReport({ sessionDir, title: "AML refs", content, allowNoEvidence: true });
    const saved = await readFile(path.join(sessionDir, report.path), "utf8");
    expect(saved).toMatch(/## 参考文献\n\n1\. \[1\] Mayer[\s\S]*\n2\. \[2\] Büchner/);
    expect(saved).toMatch(/PMID: 23630210\.\n3\. \[3\] Burnett/);
    expect(saved).toMatch(/PMID: 23940227\.\n4\. \[4\] Bradstock/);
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
    expect(saved).toContain("## 参考文献\n\n1. [1] First citation.\n2. [2] Second citation. PMID: 123.\n3. [3] Third citation.");
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
      quote: "second result",
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
    expect(saved).toContain("## 参考文献\n\n1. [1] Randomized trial one.\n2. [2] Randomized trial two.");
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

  it("repairs a matching report whose metadata sidecar is missing", async () => {
    const { sessionDir, evidence } = await fixture();
    const input = {
      sessionDir,
      title: "Recoverable report",
      content: `# Conclusion\n\nTreatment reduced mortality [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    };
    const first = await writeReport(input);
    await rm(path.join(sessionDir, `${first.path}.metadata.json`));

    const recovered = await writeReport(input);

    expect(recovered.path).toBe(first.path);
    await expect(readFile(path.join(sessionDir, `${first.path}.metadata.json`), "utf8")).resolves.toContain(first.sha256);
  });

  it("does not claim success when a matching report has a conflicting metadata sidecar", async () => {
    const { sessionDir, evidence } = await fixture();
    const input = {
      sessionDir,
      title: "Conflicting sidecar report",
      content: `# Conclusion\n\nTreatment reduced mortality [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    };
    const first = await writeReport(input);
    await writeFile(path.join(sessionDir, `${first.path}.metadata.json`), JSON.stringify({ sha256: "wrong" }), "utf8");

    const next = await writeReport(input);

    expect(next.path).toBe("reports/conflicting-sidecar-report-2.md");
    await expect(readFile(path.join(sessionDir, `${next.path}.metadata.json`), "utf8")).resolves.toContain(next.sha256);
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

  it("allows an unverified mirror when its provenance is preserved", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
    await writeFile(path.join(sessionDir, "mirror.md"), "Unverified guideline recommendation.", "utf8");
    const evidence = await addEvidence({
      sessionDir,
      question: "What does the guideline recommend?",
      claim: "The guideline recommends treatment.",
      relation: "supports",
      provenance: "guideline_mirror_unverified",
      sourcePath: "mirror.md",
      quote: "Unverified guideline recommendation.",
    });
    await expect(writeReport({
      sessionDir,
      title: "Unverified recommendation",
      content: `Claim [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    })).resolves.toMatchObject({ evidenceIds: [evidence.id] });
  });

  it("requires explicit opt-in for an evidence-gap report", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-report-"));
    await expect(writeReport({ sessionDir, title: "Gap", content: "No eligible studies found." })).rejects.toThrow(/no evidence references/);
    const report = await writeReport({ sessionDir, title: "Gap", content: "No eligible studies found.", allowNoEvidence: true });
    expect(report.evidenceIds).toEqual([]);
  });
});
