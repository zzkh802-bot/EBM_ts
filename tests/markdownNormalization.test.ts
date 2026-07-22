import { describe, expect, it } from "vitest";
import { cleanExternalText, normalizeMarkdown } from "../src/tools/markdown.js";

describe("normalizeMarkdown", () => {
  it("splits pathological one-line prose into deterministic stable lines", () => {
    const sentence = "This evidence sentence contains enough words to represent reader output without changing its meaning.";
    const input = Array.from({ length: 40 }, () => sentence).join(" ");

    const first = normalizeMarkdown(input, { maxLineLength: 160 });
    const second = normalizeMarkdown(input, { maxLineLength: 160 });
    const lines = first.split("\n");

    expect(first).toBe(second);
    expect(lines.length).toBeGreaterThan(10);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(160);
    expect(first.replace(/\n/g, " ")).toBe(input);
  });

  it("cleans encoded entities, zero-width characters, non-breaking spaces, and controls", () => {
    const input = "BP&#xa0;&lt;185/110&#x2009;mmHg\u200B\u0007 and &amp; mortality";
    expect(cleanExternalText(input)).toBe("BP <185/110 mmHg and & mortality");
  });

  it("does not wrap fenced code or Markdown table rows", () => {
    const code = `\`\`\`json\n${"x".repeat(300)}\n\`\`\``;
    const table = `| column | value |\n| --- | --- |\n| item | ${"y".repeat(300)} |`;
    const input = `${code}\n\n${table}`;

    expect(normalizeMarkdown(input, { maxLineLength: 80 })).toBe(input);
  });
});
