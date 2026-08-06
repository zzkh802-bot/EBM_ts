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

    expect(located.quote).toBe(source);
    expect(located.matchMode).toBe("noise_normalized");
  });

  it("does not let symbol stripping turn a changed decimal into a match", () => {
    const source = "风险为 3.0%。结论明确。";

    expect(() => locateEvidenceAnchors(
      source,
      "风险为 30%",
      "结论明确",
      { lineStart: 1, lineEnd: 1 },
    )).toThrow(/未能在限定|候选/);
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
    ].join("\n");

    expect(() => locateEvidenceAnchors(
      source,
      "Outside target starts here",
      "Outside target ends here",
      { lineStart: 3, lineEnd: 3 },
    )).toThrowError(/未能在限定/);

    try {
      locateEvidenceAnchors(source, "Outside target starts here", "Outside target ends here", { lineStart: 3, lineEnd: 3 });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("Outside target starts here");
    }
  });
});
