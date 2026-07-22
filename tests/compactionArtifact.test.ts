import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveCompactionArtifact } from "../src/tools/compactionArtifact.js";

describe("Pi compaction artifacts", () => {
  it("persists Pi's completed summary without replacing its compaction behavior", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-compact-"));
    const result = await saveCompactionArtifact({
      sessionDir,
      sessionId: "session-1",
      reason: "threshold",
      willRetry: false,
      fromExtension: false,
      entry: {
        id: "abc123",
        timestamp: "2026-01-01T00:00:00.000Z",
        summary: "# Summary\n\nImportant evidence state.",
        firstKeptEntryId: "kept1",
        tokensBefore: 12345,
      },
    });

    expect(result.path).toBe("compactions/abc123.json");
    const saved = JSON.parse(await readFile(path.join(sessionDir, result.path), "utf8"));
    expect(saved).toMatchObject({
      session_id: "session-1",
      reason: "threshold",
      summary: "# Summary\n\nImportant evidence state.",
      tokens_before: 12345,
    });
  });
});
