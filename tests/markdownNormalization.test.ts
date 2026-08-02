import { describe, expect, it } from "vitest";
import { cleanExternalText, normalizeMarkdown, preprocessExternalContent } from "../src/tools/markdown.js";

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

describe("preprocessExternalContent", () => {
  it("turns HTML paragraphs and a simple table into readable Markdown", () => {
    const input = [
      "<article><h2>推荐</h2>",
      "<p>对于 CrCl 15&ndash;29 mL/min 的患者，建议减量。</p>",
      "<table><tr><th>药物</th><th>剂量</th></tr><tr><td>阿哌沙班</td><td>5 mg bid</td></tr></table>",
      "</article>",
    ].join("");

    const output = preprocessExternalContent(input);

    expect(output).toContain("## 推荐");
    expect(output).toContain("对于 CrCl 15–29 mL/min 的患者，建议减量。");
    expect(output).toContain("| 药物");
    expect(output).toContain("| 阿哌沙班");
    expect(output).not.toMatch(/<\/?(?:article|h2|p|table|tr|th|td)\b/i);
  });

  it("keeps image labels but never exposes data URIs", () => {
    const output = preprocessExternalContent(
      '<figure><img src="data:image/png;base64,TOP_SECRET_BYTES" alt="主要结局森林图"><figcaption>图 2：主要结局</figcaption></figure>',
      { format: "html" },
    );

    expect(output).toContain("[图像：主要结局森林图]");
    expect(output).toContain("图 2：主要结局");
    expect(output).not.toContain("data:image");
    expect(output).not.toContain("TOP_SECRET_BYTES");
  });

  it("marks merged-cell tables instead of implying a lossless layout conversion", () => {
    const output = preprocessExternalContent(
      '<table><tr><th>药物</th><th>条件</th></tr><tr><td>阿哌沙班</td><td rowspan="2">年龄、体重、肾功能</td></tr><tr><td>达比加群</td></tr></table>',
      { format: "html" },
    );

    expect(output).toContain("表格含合并单元格");
    expect(output).toContain("行列关系需回原文核验");
    expect(output).toContain("年龄、体重、肾功能");
  });

  it("decodes repeated transport-escaped line breaks without rewriting code-like text", () => {
    expect(preprocessExternalContent("第一段\\n\\n第二段\\n第三段", { format: "plain" })).toBe("第一段\n\n第二段\n第三段");
    expect(preprocessExternalContent(String.raw`C:\new\trial`, { format: "plain" })).toBe(String.raw`C:\new\trial`);
    expect(preprocessExternalContent('```json\n{"text":"first\\nsecond"}\n```', { format: "markdown" }))
      .toBe('```json\n{"text":"first\\nsecond"}\n```');
  });

  it("recognizes XML-like clinical sections while preserving their text", () => {
    const output = preprocessExternalContent(
      "<sec><title>Results</title><p>Mortality was lower.</p><p>BP &lt;185/110 mmHg.</p></sec>",
      { format: "xml" },
    );

    expect(output).toContain("## Results");
    expect(output).toContain("Mortality was lower.");
    expect(output).toContain("BP <185/110 mmHg.");
    expect(output).not.toMatch(/<\/?(?:sec|title|p)\b/i);
  });

  it("leaves ordinary Markdown and clinical comparison signs alone", () => {
    const input = "# Eligibility\n\nUse treatment when BP <185/110 mmHg and age < 80 years.";
    expect(preprocessExternalContent(input)).toBe(input);
  });
});
