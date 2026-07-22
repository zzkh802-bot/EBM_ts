import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveToolText, readableArchivePath } from "../src/extensions/archiveOutput.js";
import { archiveSource, stableArchiveName } from "../src/tools/archive.js";

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

  it("returns distinct workspace-readable and evidence-relative paths", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({ sessionDir, kind: "read", title: "Stroke guideline", content: "recommendation" });
    const readable = readableArchivePath("session-1", record.path);
    const output = archiveToolText(record, readable).text;

    expect(output).toContain(`Evidence source_path: ${record.path}`);
    expect(output).toContain(`Readable archive path: data/sessions/session-1/${record.path}`);
    expect(output).toContain(`Archive lines: 1-${record.bodyLineStart + record.lines - 1}`);
    expect(output).toContain(`read(path=${JSON.stringify(readable)}, offset=N, limit=M)`);
  });

  it("labels search snapshots as discovery-only while preserving a read continuation", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({ sessionDir, kind: "search", title: "query", content: "# Search\n\nResult" });
    const output = archiveToolText(record, readableArchivePath("session-1", record.path), { citationEligible: false }).text;
    expect(output).toContain(`Discovery archive path: ${record.path}`);
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
    expect(output.text).toContain("use the same source_path and 1-based offset/limit with evidence_add");
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
});
