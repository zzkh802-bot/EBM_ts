import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveToolText, readableArchivePath } from "../src/extensions/archiveOutput.js";
import { archiveSource, stableArchiveName } from "../src/tools/archive.js";
import { addEvidenceFromSourceSpan } from "../src/tools/evidence.js";
import { quoteReadySourceSpans } from "../src/tools/sourceIdentity.js";

describe("source archive", () => {
  it("uses semantic deterministic names and writes source metadata", async () => {
    const input = { kind: "read" as const, sourceUrl: "https://example.com", title: "Example Clinical Guideline 2025", content: "body" };
    expect(stableArchiveName(input)).toBe("example-clinical-guideline-2025.md");
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({ sessionDir, ...input });
    const saved = await readFile(path.join(sessionDir, record.path), "utf8");
    expect(saved).toContain("source_url: \"https://example.com\"");
    expect(saved).toContain("body");
    expect(record.sha256).toHaveLength(64);
  });

  it("assigns one document identity and distinct source identities to MCP chunks", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const first = await archiveSource({
      sessionDir, kind: "read", layout: "file", title: "Stroke guideline",
      sourceUrl: "mcp://guideline/g1#chunk-1", content: "First recommendation.",
    });
    const second = await archiveSource({
      sessionDir, kind: "read", layout: "file", title: "Stroke guideline",
      sourceUrl: "mcp://guideline/g1#chunk-2", content: "Second recommendation.",
    });

    expect(first.documentId).toMatch(/^doc_[a-f0-9]{16}$/);
    expect(first.sourceId).toMatch(/^src_[a-f0-9]{16}$/);
    expect(second.documentId).toBe(first.documentId);
    expect(second.sourceId).not.toBe(first.sourceId);
    expect(archiveToolText(first).text).toContain(`Source ID: ${first.sourceId}`);
    expect(archiveToolText(first).text).toContain(`Document ID: ${first.documentId}`);
  });

  it("renders quote-ready spans for any citation-capable archived source", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({
      sessionDir,
      kind: "read",
      title: "Web trial",
      sourceUrl: "https://example.test/trial",
      content: "The intervention reduced the primary outcome.",
    });
    const spans = await quoteReadySourceSpans({
      sessionDir,
      sourcePath: record.path,
      sourceId: record.sourceId,
      content: record.content,
    });
    const output = archiveToolText(record, readableArchivePath("session-1", record.path), {
      quoteReadySpans: spans,
    }).text;

    expect(output).toContain("Quote-ready continuous spans");
    expect(output).toContain(`source_span_id: ${spans[0]!.id}`);
    expect(output).toContain("The intervention reduced the primary outcome.");
    const evidence = await addEvidenceFromSourceSpan({
      sessionDir,
      question: "Does the intervention work?",
      claim: "The intervention reduced the primary outcome.",
      relation: "supports",
      sourceSpanId: spans[0]!.id,
    });
    expect(evidence).toMatchObject({ sourceId: record.sourceId, documentId: record.documentId, quote: record.content });
  });

  it("preserves non-Latin semantics and never overwrites a different source revision", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const first = await archiveSource({ sessionDir, kind: "read", title: "中国高血压防治指南 2024", content: "first revision" });
    const duplicate = await archiveSource({ sessionDir, kind: "read", title: "中国高血压防治指南 2024", content: "first revision" });
    const second = await archiveSource({ sessionDir, kind: "read", title: "中国高血压防治指南 2024", content: "second revision" });

    expect(first.path).toBe("sources/read/中国高血压防治指南-2024/full.md");
    expect(first.tocPath).toBe("sources/read/中国高血压防治指南-2024/toc.md");
    expect(duplicate.path).toBe(first.path);
    expect(second.path).toBe("sources/read/中国高血压防治指南-2024-2/full.md");
    expect(await readFile(path.join(sessionDir, first.path), "utf8")).toContain("first revision");
  });

  it("preserves selected source resources beside full Markdown with a hash manifest", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({
      sessionDir,
      kind: "read",
      title: "Illustrated guideline",
      content: "# Guideline\n\n![Algorithm](images/algorithm.png)",
      resources: [{ path: "images/algorithm.png", bytes: new TextEncoder().encode("png-bytes"), mediaType: "image/png" }],
    });
    expect(record.resourcePaths).toEqual(["images/algorithm.png"]);
    expect(await readFile(path.join(sessionDir, record.archiveDir!, "images", "algorithm.png"), "utf8")).toBe("png-bytes");
    const manifest = await readFile(path.join(sessionDir, record.archiveDir!, ".metadata", "resources.json"), "utf8");
    expect(manifest).toContain('"path": "images/algorithm.png"');
    expect(manifest).toContain('"sha256"');
  });

  it("does not reuse a read archive when identical Markdown has different resources", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const first = await archiveSource({
      sessionDir,
      kind: "read",
      title: "Illustrated guideline",
      content: "# Guideline\n\n![Algorithm](images/algorithm.png)",
    });
    const second = await archiveSource({
      sessionDir,
      kind: "read",
      title: "Illustrated guideline",
      content: "# Guideline\n\n![Algorithm](images/algorithm.png)",
      resources: [{ path: "images/algorithm.png", bytes: new TextEncoder().encode("png-bytes"), mediaType: "image/png" }],
    });
    expect(second.archiveDir).not.toBe(first.archiveDir);
    expect(second.resourcePaths).toEqual(["images/algorithm.png"]);
  });

  it("returns distinct workspace-readable and evidence-relative paths", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({ sessionDir, kind: "read", title: "Stroke guideline", content: "recommendation" });
    const readable = readableArchivePath("session-1", record.path);
    const output = archiveToolText(record, readable).text;

    expect(output).toContain(`Readable archive path: data/sessions/session-1/${record.path}`);
    expect(output).not.toContain("Evidence source_path:");
    expect(output).toContain(`Archive lines: 1-${record.bodyLineStart + record.lines - 1}`);
    expect(output).toContain(`read(path=${JSON.stringify(readable)}, offset=N, limit=M)`);
  });

  it("labels search snapshots as discovery-only while preserving a read continuation", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({ sessionDir, kind: "search", title: "query", content: "# Search\n\nResult" });
    const output = archiveToolText(record, readableArchivePath("session-1", record.path), { citationEligible: false }).text;
    expect(output).toContain(`Readable archive path: data/sessions/session-1/${record.path}`);
    expect(output).toContain("cannot be passed to evidence_add");
    expect(output).toContain("Read any archive window with read(");
    expect(output).not.toContain("Evidence source_path:");
  });

  it("returns a bounded read preview and a one-based heading map", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const content = `# Introduction\n\n${"clinical evidence ".repeat(500)}\n\n## Results\n\nOutcome improved.`;
    const record = await archiveSource({ sessionDir, kind: "read", title: "Long source", content });
    const output = archiveToolText(record, readableArchivePath("session-1", record.path), { compactRead: true });

    expect(output.truncated).toBe(true);
    expect(output.text).toContain("Source map:");
    expect(output.text).toContain("Readable source index:");
    expect(await readFile(path.join(sessionDir, record.tocPath!), "utf8")).toContain("H2 Results — lines");
    expect(output.text).toContain(`# Introduction — line ${record.bodyLineStart}`);
    expect(output.text).toContain("## Results — line");
    expect(output.text).toContain("Preview truncated at 5000 bytes");
    expect(output.text).toContain("Continue without gaps");
    expect(output.text).toMatch(/Continue without gaps.*offset=\d+, limit=200/);
    expect(output.text).toContain("For evidence_add, pass the Source ID above with a minimal, sufficient, continuous verbatim quote");
  });

  it("normalizes content before hashing, archiving, and returning model-visible text", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const input = Array.from({ length: 30 }, (_, index) => `sentence-${index} has biomedical evidence content.`).join(" ");

    const record = await archiveSource({ sessionDir, kind: "read", content: input });
    const saved = await readFile(path.join(sessionDir, record.path), "utf8");
    const archivedBody = saved.split("---\n\n", 2)[1]!;

    expect(record.content).toBe(archivedBody);
    expect(record.content.split("\n").length).toBeGreaterThan(1);
    expect(record.lines).toBe(record.content.split("\n").length);
    expect(saved.split("\n").slice(record.bodyLineStart - 1).join("\n")).toBe(record.content);
  });

  it("returns exactly the same cleaned markup that it persists as the citation body", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({
      sessionDir,
      kind: "read",
      title: "HTML guideline",
      contentFormat: "html",
      content: '<section><h2>Recommendation</h2><p>Use treatment when BP &lt;185/110 mmHg.</p><table><tr><th>Group</th><th>Dose</th></tr><tr><td>Adult</td><td>5 mg</td></tr></table></section>',
    });
    const saved = await readFile(path.join(sessionDir, record.path), "utf8");
    const archivedBody = saved.split("\n").slice(record.bodyLineStart - 1).join("\n");

    expect(record.content).toBe(archivedBody);
    expect(record.content).toContain("## Recommendation");
    expect(record.content).toContain("| Adult");
    expect(record.content).not.toContain("<section>");
  });
});
