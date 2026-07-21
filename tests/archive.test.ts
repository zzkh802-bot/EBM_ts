import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveSource, stableArchiveName } from "../src/tools/archive.js";

describe("source archive", () => {
  it("uses deterministic names and writes source metadata", async () => {
    const input = { kind: "read" as const, sourceUrl: "https://example.com", title: "Example", content: "body" };
    expect(stableArchiveName(input)).toBe(stableArchiveName(input));
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-archive-"));
    const record = await archiveSource({ sessionDir, ...input });
    const saved = await readFile(path.join(sessionDir, record.path), "utf8");
    expect(saved).toContain("source_url: \"https://example.com\"");
    expect(saved).toContain("body");
    expect(record.sha256).toHaveLength(64);
  });
});
