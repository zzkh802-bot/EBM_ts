import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

    expect(first.path).toBe("sources/read/中国高血压防治指南-2024.md");
    expect(duplicate.path).toBe(first.path);
    expect(second.path).toBe("sources/read/中国高血压防治指南-2024-2.md");
    expect(await readFile(path.join(sessionDir, first.path), "utf8")).toContain("first revision");
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
    expect(saved.split("\n").slice(record.bodyLineOffset).join("\n")).toBe(record.content);
  });
});
