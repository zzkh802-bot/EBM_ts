import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addEvidence, listEvidence, readEvidence, verifyEvidence } from "../src/tools/evidence.js";

describe("Markdown evidence ledger", () => {
  describe("quote-anchored source location", () => {
    it("stores a unique exact quote and derives its source coordinates", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      await writeFile(path.join(dir, "source.md"), "background\nimportant exact quote\nlimitations", "utf8");

      const node = await addEvidence({
        sessionDir: dir,
        question: "Does intervention improve outcome?",
        claim: "Intervention improves outcome.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "important exact quote",
      });

      expect(node).toMatchObject({
        quote: "important exact quote",
        lineStart: 2,
        lineEnd: 2,
        charStart: 11,
        charEnd: 32,
        matchMode: "exact",
      });
    });

    it("matches harmless Chinese layout breaks but stores the canonical archived text", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const source = "治疗可显著降低\n卒中风险，且不增加全因死亡。";
      await writeFile(path.join(dir, "source.md"), source, "utf8");

      const node = await addEvidence({
        sessionDir: dir,
        question: "What are the treatment effects?",
        claim: "Treatment reduces stroke without increasing all-cause mortality.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "治疗可显著降低卒中风险，且不增加全因死亡。",
      });

      expect(node).toMatchObject({
        quote: source,
        lineStart: 1,
        lineEnd: 2,
        charStart: 0,
        charEnd: source.length,
        matchMode: "layout_normalized",
      });
      expect(await verifyEvidence(dir, node)).toEqual({ ok: true, errors: [] });
    });

    it("ignores paired Markdown emphasis markers while preserving the canonical quote", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const source = "**HIGH-VALUE CARE ADVICE 4:** Clinicians should not prescribe antibiotics for patients with the common cold.";
      await writeFile(path.join(dir, "source.md"), source, "utf8");

      const node = await addEvidence({
        sessionDir: dir,
        question: "Should clinicians prescribe antibiotics for the common cold?",
        claim: "Clinicians should not prescribe antibiotics for the common cold.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "HIGH-VALUE CARE ADVICE 4: Clinicians should not prescribe antibiotics for patients with the common cold.",
      });

      expect(node).toMatchObject({ quote: source, matchMode: "layout_normalized" });
      expect(await verifyEvidence(dir, node)).toEqual({ ok: true, errors: [] });
    });

    it("uses the same evidence id regardless of exact or layout-normalized submission", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const source = "治疗可显著降低\n卒中风险";
      await writeFile(path.join(dir, "source.md"), source, "utf8");
      const base = {
        sessionDir: dir,
        question: "Does treatment reduce stroke?",
        claim: "Treatment reduces stroke.",
        relation: "supports" as const,
        sourcePath: "source.md",
      };

      const normalized = await addEvidence({ ...base, quote: "治疗可显著降低卒中风险" });
      const exact = await addEvidence({ ...base, quote: source });

      expect(normalized.matchMode).toBe("layout_normalized");
      expect(exact.matchMode).toBe("exact");
      expect(exact.id).toBe(normalized.id);
    });

    it("returns canonical source candidates when only a small part of the attempted quote differs", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const source = "抗栓治疗导致的绝对颅外大出血年增加率不超过 0.3%，小于卒中风险降低幅度。";
      await writeFile(path.join(dir, "source.md"), source, "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "What is the bleeding tradeoff?",
        claim: "The absolute bleeding increase is smaller than the stroke reduction.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "抗栓治疗导致的绝对颅外大出血年增加率约为 0.3%，小于卒中风险降低幅度。",
      })).rejects.toThrow(/候选 1[\s\S]*第 1 行[\s\S]*不超过 0\.3%[\s\S]*复制.*连续原文[\s\S]*重试/);
    });

    it("never auto-accepts a changed clinical number even when the surrounding text matches", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      await writeFile(path.join(dir, "source.md"), "严重出血的年绝对增加率不超过 0.3%，总体获益仍占优势。", "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "What is the annual bleeding increase?",
        claim: "The annual absolute increase is 3.0%.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "严重出血的年绝对增加率不超过 3.0%，总体获益仍占优势。",
      })).rejects.toThrow(/未能在归档来源中唯一定位|候选/);
    });

    it("does not treat an OCR character substitution as layout normalization", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      await writeFile(path.join(dir, "source.md"), "符合条件的患者可使用阿哌沙班 5 mg 每日 2 次。", "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "What dose was stated?",
        claim: "The source states an apixaban dose.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "符合条件的患者可使用阿派沙班 5 mg 每日 2 次。",
      })).rejects.toThrow(/候选 1[\s\S]*阿哌沙班 5 mg/);
    });

    it("does not normalize across paragraph boundaries into a discontinuous quote", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      await writeFile(path.join(dir, "source.md"), "治疗可以降低卒中\n\n严重出血风险增加", "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "What does the source conclude?",
        claim: "Both conclusions form one supporting statement.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "治疗可以降低卒中严重出血风险增加",
      })).rejects.toThrow(/未能在归档来源中唯一定位/);
    });

    it("rejects duplicate exact quotes and returns each source location", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      await writeFile(path.join(dir, "source.md"), "## Recommendation A\n推荐进行治疗。\n\n## Recommendation B\n推荐进行治疗。", "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "What is recommended?",
        claim: "Treatment is recommended.",
        relation: "supports",
        sourcePath: "source.md",
        quote: "推荐进行治疗。",
      })).rejects.toThrow(/匹配到 2 处[\s\S]*第 1–2 行[\s\S]*第 4–5 行[\s\S]*增加.*上下文/);
    });
  });

  describe("historical clinical regression fixtures", () => {
    it("recovers the canonical Hart abstract passage after a small wording difference", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const archived = [
        "## Abstract",
        "",
        "**CONCLUSIONS:** Adjusted-dose warfarin and antiplatelet agents reduce stroke by approximately 60% and by approximately 20%, respectively, in patients who have atrial fibrillation. Warfarin is",
        "substantially more efficacious (by approximately 40%) than antiplatelet therapy. Absolute increases in major extracranial hemorrhage associated with antithrombotic therapy in participants from the",
        "trials included in this meta-analysis were less than the absolute reductions in stroke. Judicious use of antithrombotic therapy importantly reduces stroke for most patients who have atrial",
        "fibrillation.",
        "",
        "## PubMed context",
        "",
        "Navigation/context only.",
      ].join("\n");
      await writeFile(path.join(dir, "hart.md"), archived, "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "What is the net clinical benefit of antithrombotic therapy?",
        claim: "The bleeding increase was smaller than the stroke reduction.",
        relation: "supports",
        provenance: "primary_abstract",
        sourcePath: "hart.md",
        quote: "Absolute increases in major extracranial hemorrhage associated with antithrombotic therapy in participants from the trials included in this meta-analysis were smaller than the absolute reductions in stroke.",
      })).rejects.toThrow(/候选 1[\s\S]*were less than the absolute reductions in stroke/);
    });

    it("rejects the historical CALGB abstract quote when it accidentally includes PubMed navigation context", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const abstract = [
        "The Cancer and Leukemia Group B (CALGB) study 9222 tested the hypothesis that treatment intensification of acute myeloid leukemia (AML) in first remission with multiple chemotherapy agents is superior",
        "to high-dose cytarabine (HiDAC) alone. There was no difference in disease-free survival (DFS) between the 2 regimens (P = .66).",
        "Toxicity was greater with multiagent chemotherapy. These 2 postremission regimens produced similar outcomes.",
      ].join("\n");
      const context = "## PubMed context\n\nNavigation/context only. Linked records below are not citation evidence unless separately read and archived.\n\nDOI: 10.1182/blood-2004-08-2977";
      await writeFile(path.join(dir, "calgb.md"), ["Source status: PubMed abstract only; full text unavailable", "", "## Abstract", "", abstract, "", context].join("\n"), "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "How did CALGB 9222 compare the consolidation regimens?",
        claim: "DFS was similar and multiagent chemotherapy was more toxic.",
        relation: "supports",
        provenance: "primary_abstract",
        sourcePath: "calgb.md",
        quote: `${abstract}\n\n${context}`,
      })).rejects.toThrow(/PubMed context|primary_abstract evidence must stay inside/);

      await expect(addEvidence({
        sessionDir: dir,
        question: "How did CALGB 9222 compare the consolidation regimens?",
        claim: "DFS was similar and multiagent chemotherapy was more toxic.",
        relation: "supports",
        provenance: "primary_abstract",
        sourcePath: "calgb.md",
        quote: abstract,
      })).resolves.toMatchObject({ quote: abstract, citationEligible: true });
    });

    it("rejects the fragmented NOAC table passage archived by the historical atrial-fibrillation run", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
      const fragmented = [
        "减少", "减少", "减少", "减少", "减少",
        "注:NOAC 为非维生素 K 拮抗剂口服抗凝药; a相比华法林,艾多沙班 30 mg 1 次/d 增加缺血性卒中风险[84]表 11 NOAC 剂量推荐",
        "[82‐85]", "项目", "达比加群利伐沙班阿哌沙班艾多沙班150 mg 2 次/d 或 110 mg 2 次/d",
        "20 mg 1 次/d", "5 mg 2 次/d", "标准剂量", "15 mg 1 次/d", "2.5 mg 2 次/d", "低剂量", "无",
        "以下患者推荐口服达比加群 110 mgCrCl 15~29 ml/min 或如下 3 条中满足如下任何一条:CrCl 30~50 ml/低剂量或2 次/d:年龄≥80 岁;合用维拉帕米;",
        "满足 2 条:年龄≥80 岁、体重≤更低剂出血风险高;CrCl 30~50 ml/min60 kg、血肌酐≥133 μmol/L量标准注:NOAC 为非维生素 K 拮抗剂口服抗凝药,CrCl 为肌酐清除率表 12 NOAC 药物代谢动力学及 AAD 对 NOAC 抗凝作用的影响",
        "项目", "达比加群非肾脏/肾脏途径清除",
      ].join("\n");
      await writeFile(path.join(dir, "af-guideline.md"), fragmented, "utf8");

      await expect(addEvidence({
        sessionDir: dir,
        question: "How do NOACs compare with warfarin?",
        claim: "NOACs are noninferior or superior and reduce intracranial bleeding.",
        relation: "supports",
        provenance: "guideline_official",
        sourcePath: "af-guideline.md",
        quote: fragmented,
      })).rejects.toThrow(/fragmented PDF table/);
    });
  });

  it("stores exact source quotes and verifies them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "line 0\nimportant quote\nline 2", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "Does intervention improve outcome?",
      claim: "Intervention improves outcome.",
      relation: "supports",
      sourcePath: "source.md",
      quote: "important quote",
    });

    expect(node.quote).toBe("important quote");
    expect(node.confidence).toBe("moderate");
    expect(await verifyEvidence(dir, node)).toEqual({ ok: true, errors: [] });
    const persisted = await readFile(path.join(dir, "evidence", `${node.id}.md`), "utf8");
    expect(persisted).toContain(`evidence_id: ${node.id}`);
    expect(persisted).toContain(`content_hash: ${node.contentHash}`);
    expect(persisted).toContain("confidence: moderate");
    expect(persisted).toContain("## Exact Quote\n\n```text\nimportant quote\n```");
    expect(persisted).not.toContain(JSON.stringify(node));
    const index = await readFile(path.join(dir, "evidence", "EVIDENCE.md"), "utf8");
    expect(index).toContain(`[${node.id}](${node.id}.md)`);
    expect(index).toContain("Intervention improves outcome.");
  });

  it("lists and reads persisted Markdown evidence through public interfaces", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "background\nexact result", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "What is the effect?",
      claim: "The intervention has an effect.",
      relation: "supports",
      sourcePath: "source.md",
      quote: "exact result",
    });

    expect(await listEvidence(dir)).toEqual([
      expect.objectContaining({ id: node.id, relation: "supports", claim: node.claim, path: `evidence/${node.id}.md` }),
    ]);
    const read = await readEvidence(dir, node.id);
    expect(read.node).toEqual(node);
    expect(read.markdown).toContain("exact result");
    expect(read.verification).toEqual({ ok: true, errors: [] });
  });

  it("stores confidence labels and reads legacy Chinese labels", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "tentative quote", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "Is this direct?",
      claim: "The evidence is tentative.",
      relation: "partially_supports",
      confidence: "low",
      sourcePath: "source.md",
      quote: "tentative quote",
    });
    expect(node.confidence).toBe("low");
    expect((await listEvidence(dir))[0]).toMatchObject({ confidence: "low" });
    await writeFile(path.join(dir, "evidence", `${node.id}.md`), (await readFile(path.join(dir, "evidence", `${node.id}.md`), "utf8")).replace("confidence: low", "confidence: 低"), "utf8");
    expect((await readEvidence(dir, node.id)).node.confidence).toBe("low");
  });

  it("continues to verify legacy line-addressed evidence records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "background\nlegacy exact line", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "What did the legacy source report?",
      claim: "The legacy record remains verifiable.",
      relation: "supports",
      sourcePath: "source.md",
      quote: "legacy exact line",
    });
    const recordPath = path.join(dir, "evidence", `${node.id}.md`);
    const legacy = (await readFile(recordPath, "utf8"))
      .replace(/^source_char_start:.*\n/m, "")
      .replace(/^source_char_end:.*\n/m, "")
      .replace(/^source_match_mode:.*\n/m, "");
    await writeFile(recordPath, legacy, "utf8");

    const read = await readEvidence(dir, node.id);
    expect(read.node).not.toHaveProperty("charStart");
    expect(read.node).not.toHaveProperty("matchMode");
    expect(read.verification).toEqual({ ok: true, errors: [] });
  });

  it("marks discovery snippets and unverified guideline mirrors as citation-ineligible", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "A search result claims a recommendation.", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "What does the guideline recommend?",
      claim: "Unverified recommendation lead.",
      relation: "partially_supports",
      provenance: "guideline_mirror_unverified",
      sourcePath: "source.md",
      quote: "A search result claims a recommendation.",
    });
    expect(node).toMatchObject({ provenance: "guideline_mirror_unverified", citationEligible: false });
    expect((await readEvidence(dir, node.id)).node.provenance).toBe("guideline_mirror_unverified");
  });

  it("records expert consensus separately from guidelines", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "consensus.md"), "Expert consensus recommends local practice.", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "What does the source support?",
      claim: "The source is consensus-level support, not authoritative guideline evidence.",
      relation: "supports",
      provenance: "expert_consensus",
      confidence: "moderate",
      sourcePath: "consensus.md",
      quote: "Expert consensus recommends local practice.",
    });
    expect(node).toMatchObject({ provenance: "expert_consensus", citationEligible: true });
    expect((await listEvidence(dir))[0]).toMatchObject({ provenance: "expert_consensus" });
  });

  it("rejects discovery search snapshots even when provenance is omitted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await mkdir(path.join(dir, "sources", "search"), { recursive: true });
    await writeFile(path.join(dir, "sources", "search", "query.md"), "Search snippet", "utf8");
    await expect(addEvidence({
      sessionDir: dir,
      question: "q",
      claim: "c",
      relation: "supports",
      sourcePath: "sources/search/query.md",
      quote: "Search snippet",
    })).rejects.toThrow(/discovery artifacts/);
  });

  it("rejects PubMed navigation context as primary abstract evidence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await mkdir(path.join(dir, "sources", "read", "pubmed"), { recursive: true });
    await writeFile(path.join(dir, "sources", "read", "pubmed", "full.md"), [
      "# Trial", "", "Source status: PubMed abstract only; full text unavailable", "", "## Abstract", "", "The trial reduced stroke by 30%.", "",
      "## PubMed context", "", "Navigation/context only. Linked records below are not citation evidence unless separately read and archived.", "", "DOI: 10.1000/test",
    ].join("\n"), "utf8");

    await expect(addEvidence({
      sessionDir: dir,
      question: "Does treatment reduce stroke?",
      claim: "Treatment reduced stroke.",
      relation: "supports",
      provenance: "primary_abstract",
      sourcePath: "sources/read/pubmed/full.md",
      quote: "## PubMed context\n\nNavigation/context only. Linked records below are not citation evidence unless separately read and archived.\n\nDOI: 10.1000/test",
    })).rejects.toThrow(/PubMed context|Abstract.*7-7/);

    await expect(addEvidence({
      sessionDir: dir,
      question: "Does treatment reduce stroke?",
      claim: "Treatment reduced stroke by 30%.",
      relation: "supports",
      provenance: "primary_abstract",
      sourcePath: "sources/read/pubmed/full.md",
      quote: "The trial reduced stroke by 30%.",
    })).resolves.toMatchObject({ quote: "The trial reduced stroke by 30%.", citationEligible: true });
  });

  it("rejects severely fragmented PDF tables but accepts nearby narrative evidence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    const narrative = "在与华法林对照的试验中，NOAC 疗效不劣于或优于华法林，且颅内出血风险显著降低。";
    const brokenTable = [
      "表 10 NOAC 与华法林的有效性和安全性比较", "事件", "达比加群", "利伐沙班", "阿哌沙班", "卒中", "减少", "减少", "不劣于", "大出血", "减少", "相似", "减少", "颅内出血", "减少", "减少", "减少", "表 11 NOAC 剂量推荐", "项目", "标准剂量",
    ];
    await writeFile(path.join(dir, "guideline.md"), [narrative, ...brokenTable].join("\n"), "utf8");

    await expect(addEvidence({
      sessionDir: dir,
      question: "How do NOACs compare with warfarin?",
      claim: "NOACs reduce several outcomes.",
      relation: "supports",
      provenance: "guideline_official",
      sourcePath: "guideline.md",
      quote: brokenTable.join("\n"),
    })).rejects.toThrow(/fragmented PDF table/);

    await expect(addEvidence({
      sessionDir: dir,
      question: "How do NOACs compare with warfarin?",
      claim: "NOACs are noninferior or superior and reduce intracranial bleeding.",
      relation: "supports",
      provenance: "guideline_official",
      sourcePath: "guideline.md",
      quote: narrative,
    })).resolves.toMatchObject({ quote: narrative, citationEligible: true });
  });

  it("rejects source symlinks that escape the session directory", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    const sessionDir = path.join(parent, "session");
    await mkdir(sessionDir);
    const outside = path.join(parent, "outside.md");
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, path.join(sessionDir, "linked.md"));

    await expect(addEvidence({
      sessionDir,
      question: "q",
      claim: "c",
      relation: "supports",
      sourcePath: "linked.md",
      quote: "secret",
    })).rejects.toThrow(/outside session directory/);
  });

  it("rejects traversal source paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await expect(addEvidence({
      sessionDir: dir,
      question: "q",
      claim: "c",
      relation: "supports",
      sourcePath: "../secret.txt",
      quote: "secret",
    })).rejects.toThrow(/unsafe relative path/);
  });
});
