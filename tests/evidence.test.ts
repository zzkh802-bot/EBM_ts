import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addEvidence, verifyEvidence } from "../src/tools/evidence.js";

describe("JSON evidence ledger", () => {
  it("stores exact source slices and verifies them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "line 0\nimportant quote\nline 2", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "Does intervention improve outcome?",
      claim: "Intervention improves outcome.",
      relation: "supports",
      sourcePath: "source.md",
      offset: 1,
      limit: 1,
    });

    expect(node.quote).toBe("important quote");
    expect(await verifyEvidence(dir, node)).toEqual({ ok: true, errors: [] });
    const persisted = JSON.parse(await readFile(path.join(dir, "evidence", `${node.id}.json`), "utf8"));
    expect(persisted.contentHash).toBe(node.contentHash);
  });

  it("rejects traversal source paths", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await expect(addEvidence({
      sessionDir: dir,
      question: "q",
      claim: "c",
      relation: "supports",
      sourcePath: "../secret.txt",
      offset: 0,
      limit: 1,
    })).rejects.toThrow(/unsafe relative path/);
  });
});
