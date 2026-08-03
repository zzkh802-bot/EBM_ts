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
});
