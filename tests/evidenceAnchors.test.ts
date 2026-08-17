import { describe, expect, it } from "vitest";
import { locateEvidenceAnchors } from "../src/tools/evidenceLocator.js";

describe("evidence boundary anchors", () => {
  it("accepts a boundary copied from a read view when a source line break became a space", () => {
    const source = [
      "The long-term clinical",
      "benefit of treatment was confirmed.",
      "The outcome improved.",
    ].join("\n");

    const located = locateEvidenceAnchors(
      source,
      "The long-term clinical benefit of treatment was confirmed.",
      "The outcome improved.",
      { lineStart: 1, lineEnd: 3 },
    );

    expect(located.quote).toBe(source);
    expect(located.matchMode).toBe("layout_normalized");
    expect(located.lineStart).toBe(1);
    expect(located.lineEnd).toBe(3);
  });

  it("ignores XML/entity and punctuation noise while preserving numeric meaning", () => {
    const source = "<p>建议维持血压 &lt;185/110 mmHg。</p>";
    const located = locateEvidenceAnchors(
      source,
      "建议维持血压 < 185/110",
      "mmHg",
      { lineStart: 1, lineEnd: 1 },
    );

    expect(located.quote).toBe("建议维持血压 &lt;185/110 mmHg");
    expect(located.matchMode).toBe("noise_normalized");
  });

  it("tolerates a collapsed decimal point when only the digit count matters", () => {
    const source = "风险为 3.0%。结论明确。";

    const located = locateEvidenceAnchors(
      source,
      "风险为 30%",
      "结论明确",
      { lineStart: 1, lineEnd: 1 },
    );

    expect(located.matchMode).toBe("similarity");
    expect(located.quote).toBe("风险为 3.0%。结论明确");
  });

  it("rejects a similarity match when the model's digit count changes the fact", () => {
    const source = "风险为 3.0%。结论明确。";

    expect(() => locateEvidenceAnchors(
      source,
      "风险为 300%",
      "结论明确",
      { lineStart: 1, lineEnd: 1 },
    )).toThrow(/未能在限定/);
  });

  it("locates a single passage when the model repeats the same boundary for start and end", () => {
    const source = [
      "1. 预后良好组:",
      "(1)多疗程的大剂量 Ara-C :大剂量 Ara-C",
      "(3 g·m",
      "-2·12 h",
      "-1,6 个剂量),3 ~ 4 个疗程,单药应",
      "用",
      "[20-21](证据等级 1a)。",
      "(2)其他缓解后治疗方案:",
    ].join("\n");
    const boundary = "(1)多疗程的大剂量 Ara-C :大剂量 Ara-C (3 g·m -2·12 h -1,6 个剂量),3 ~ 4 个疗程,单药应 用 [20-21](证据等级 1a)";

    const located = locateEvidenceAnchors(source, boundary, boundary, { lineStart: 1, lineEnd: 8 });

    expect(located.quote).toBe(source.split("\n").slice(1, 7).join("\n").replace(/。$/, ""));
    expect(located.matchMode).toBe("layout_normalized");
    expect(located.lineStart).toBe(2);
    expect(located.lineEnd).toBe(7);
  });

  it("does not show out-of-scope full-source candidates for a bounded read", () => {
    const source = [
      "Outside target starts here.",
      "Outside target ends here.",
      "The current read contains unrelated material.",
      "Unrelated line.",
      "Unrelated line.",
      "Unrelated line.",
      "Unrelated line.",
      "Unrelated line.",
      "Unrelated line.",
      "Unrelated line.",
    ].join("\n");

    // More than the similarity window (±3 lines) away: still rejected.
    expect(() => locateEvidenceAnchors(
      source,
      "Outside target starts here",
      "Outside target ends here",
      { lineStart: 10, lineEnd: 10 },
    )).toThrowError(/未能在限定/);

    try {
      locateEvidenceAnchors(source, "Outside target starts here", "Outside target ends here", { lineStart: 10, lineEnd: 10 });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("Outside target starts here");
    }

    // Within the ±3 line window the unique passage is accepted as a pointer.
    const located = locateEvidenceAnchors(
      source,
      "Outside target starts here",
      "Outside target ends here",
      { lineStart: 4, lineEnd: 4 },
    );
    expect(located.quote).toBe("Outside target starts here.\nOutside target ends here");
  });

  it("folds a spelled-out clinical acronym back into its short form", () => {
    const source = [
      "CSFs frequently led to bone pain (RR 5.88; 95% CI 2.54 to 13.60; number needed to treat for an additional harmful outcome (NNTH) 3)",
      "and injection-site reactions (RR 3.59; 95% CI 2.33 to 5.53; NNTH 3).",
    ].join("\n");

    const located = locateEvidenceAnchors(
      source,
      "CSFs frequently led to bone pain (RR 5.88; 95% CI 2.54 to 13.60; NNTH 3)",
      "NNTH 3",
      { lineStart: 1, lineEnd: 2 },
    );

    expect(located.quote).toContain("number needed to treat for an additional harmful outcome (NNTH) 3");
    expect(located.quote).not.toContain("injection-site");
  });

  it("ignores markdown inline-link markup copied from the archived read", () => {
    const source = "Patients should be offered primary prophylaxis with a G-CSF when the risk of febrile neutropenia, secondary to a [chemotherapy](https://www.oncoprescribe.com/) regimen, is equal to or greater than approximately 20%";

    const located = locateEvidenceAnchors(
      source,
      "Patients should be offered primary prophylaxis with a G-CSF when the risk of febrile neutropenia, secondary to a chemotherapy regimen, is equal to or greater than approximately 20%",
      "is equal to or greater than approximately 20%",
      { lineStart: 1, lineEnd: 1 },
    );

    expect(located.quote).toBe(source);
  });

  it("resolves a repeated end marker to its first occurrence after the start", () => {
    const source = [
      "Average RDI was significantly higher in patients who received G-CSF compared with control patients (P < .001).",
      "Bone pain was reported more often with G-CSF (P < .001), and mortality did not differ (P < .001).",
    ].join("\n");

    const located = locateEvidenceAnchors(
      source,
      "Average RDI was significantly higher in patients who received G-CSF",
      "P < .001",
      { lineStart: 1, lineEnd: 2 },
    );

    expect(located.quote).toBe(source.split("\n")[0]);
  });

  it("matches an end text that overlaps the tail of a unique start text", () => {
    const source = "and for FN, it was 46% (RR = 0.54; 95% CI, 0.43 to 0.67; P < .001).\nAverage RDI was significantly higher.";

    const located = locateEvidenceAnchors(
      source,
      "for FN, it was 46% (RR = 0.54; 95% CI, 0.43 to 0.67",
      "RR = 0.54; 95% CI, 0.43 to 0.67; P < .001",
      { lineStart: 1, lineEnd: 2 },
    );

    expect(located.quote).toBe("for FN, it was 46% (RR = 0.54; 95% CI, 0.43 to 0.67; P < .001).");
  });

  it("tolerates a case difference between the model anchor and the archived source", () => {
    const source = "For infection-related mortality, RR reduction with G-CSF compared with controls was 45% (RR = 0.55; 95% CI, 0.33 to 0.90; P = .018).";

    const located = locateEvidenceAnchors(
      source,
      "for infection-related mortality, RR reduction with G-CSF compared with controls was 45%",
      "P = .018",
      { lineStart: 1, lineEnd: 1 },
    );

    expect(located.quote).toBe(source);
  });

  it("still rejects anchors whose words do not exist in the archived source", () => {
    const source = "**RESULTS:** Seventeen RCTs were identified including 3,493 patients.";

    expect(() => locateEvidenceAnchors(
      source,
      "Patients: Seventeen RCTs were identified including 3,493 patients",
      "P < .001",
      { lineStart: 1, lineEnd: 1 },
    )).toThrowError(/start_text 与 end_text 都没有逐字出现|start_text 没有逐字出现/);
  });

  it("recovers a unique passage from musically-drifting anchors via the similarity pass", () => {
    const source = [
      "the HRs (95% CIs) of dementia were 1.86 (1.58-2.19) in those with low/middle genetic susceptibility plus use of laxatives",
      "and 4.10 (3.49-4.81) for high genetic susceptibility plus use of laxatives.",
      "Additive interaction was not significant (RERI: 0.736, 95% CI: 0.127 to 1.246).",
    ].join("\n");

    // Start_text drops "s" (HRs → HR) and swaps en-dashes; end_text is verbatim.
    const located = locateEvidenceAnchors(
      source,
      "the HR (95% CIs) of dementia were 1.86 (1.58–2.19) in those with low/middle genetic susceptibility",
      "RERI: 0.736, 95% CI: 0.127 to 1.246",
      { lineStart: 1, lineEnd: 3 },
    );

    expect(located.matchMode).toBe("similarity");
    expect(located.lineStart).toBe(1);
    expect(located.lineEnd).toBe(3);
    expect(located.quote).toBe(source.slice(0, source.lastIndexOf("1.246") + 5));
  });

  it("locates an end pointer on the sentence after a similar start", () => {
    const source = [
      "Only the first sentence refers to the exposure.",
      "Additive interaction was present (RERI: 0.736, 95% CI: 0.127 to 1.246; AP: 0.180).",
    ].join("\n");

    const located = locateEvidenceAnchors(
      source,
      "Only the first sentence refers to the exposure",
      "RERI: 0.736, 95% CI: 0.127 to 1.246; AP: 0.180).",
      { lineStart: 1, lineEnd: 2 },
    );

    expect(located.quote).toBe(source);
  });

  it("accepts a unique passage a few lines outside the reported line range", () => {
    const source = [
      "Variability across trials argues for careful interpretation.",
      "Using CSFs significantly reduced the proportion of patients with FN (RR 0.27; 95% CI 0.11 to 0.70; NNTB 12).",
      "A significant reduction in early mortality was observed.",
      "The remaining trials reported heterogeneous outcomes.",
      "These findings warrant confirmatory prospective studies.",
    ].join("\n");

    // The model reported lines 4-4 though the passage is on lines 2-2; the fuzzy
    // pass widens the window several lines so a drifted line pointer still lands.
    const located = locateEvidenceAnchors(
      source,
      "Using CSFs significantly reduced the proportion of patients with FN (RR 0.27; 95% CI 0.11 to 0.70; NNTB 12",
      "NNTB 12).",
      { lineStart: 4, lineEnd: 4 },
    );

    expect(located.matchMode).toBe("similarity");
    expect(located.lineStart).toBe(2);
    expect(located.lineEnd).toBe(2);
    expect(located.quote).toBe(source.split("\n")[1]!.slice(0, -2));
  });

  it("refuses to rescue anchors outside a stale read_id receipt window", () => {
    const source = [
      "Abstract evidence starts here.",
      "Abstract evidence ends here.",
      "PubMed context starts here.",
      "PubMed context starts here.",
    ].join("\n");

    // read_id mode passes widenLineWindow: false; the receipt covers line 3.
    expect(() => locateEvidenceAnchors(
      source,
      "Abstract evidence starts",
      "Abstract evidence ends",
      { lineStart: 3, lineEnd: 3, widenLineWindow: false },
    )).toThrow(/未能在限定/);
  });
});
