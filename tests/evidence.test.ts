import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addEvidence, listEvidence, readEvidence, verifyEvidence } from "../src/tools/evidence.js";

describe("Markdown evidence ledger", () => {
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
    const persisted = await readFile(path.join(dir, "evidence", `${node.id}.md`), "utf8");
    expect(persisted).toContain(`evidence_id: ${node.id}`);
    expect(persisted).toContain(`content_hash: ${node.contentHash}`);
    expect(persisted).toContain("## Exact Quote\n\n```text\nimportant quote\n```");
    expect(persisted).not.toContain(JSON.stringify(node));
    const index = await readFile(path.join(dir, "evidence", "EVIDENCE.md"), "utf8");
    expect(index).toContain(`[${node.id}](${node.id}.md)`);
    expect(index).toContain("Intervention improves outcome.");
  });

  it("lists and reads persisted Markdown evidence through public interfaces", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "background\nexact result", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "What is the effect?",
      claim: "The intervention has an effect.",
      relation: "supports",
      sourcePath: "source.md",
      offset: 1,
      limit: 1,
    });

    expect(await listEvidence(dir)).toEqual([
      expect.objectContaining({ id: node.id, relation: "supports", claim: node.claim, path: `evidence/${node.id}.md` }),
    ]);
    const read = await readEvidence(dir, node.id);
    expect(read.node).toEqual(node);
    expect(read.markdown).toContain("exact result");
    expect(read.verification).toEqual({ ok: true, errors: [] });
  });

  it("marks discovery snippets and unverified guideline mirrors as citation-ineligible", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    await writeFile(path.join(dir, "source.md"), "A search result claims a recommendation.", "utf8");
    const node = await addEvidence({
      sessionDir: dir,
      question: "What does the guideline recommend?",
      claim: "Unverified recommendation lead.",
      relation: "partially_supports",
      provenance: "guideline_mirror_unverified",
      sourcePath: "source.md",
      offset: 0,
      limit: 1,
    });
    expect(node).toMatchObject({ provenance: "guideline_mirror_unverified", citationEligible: false });
    expect((await readEvidence(dir, node.id)).node.provenance).toBe("guideline_mirror_unverified");
  });

  it("rejects source symlinks that escape the session directory", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ebm-evidence-"));
    const sessionDir = path.join(parent, "session");
    await mkdir(sessionDir);
    const outside = path.join(parent, "outside.md");
    await writeFile(outside, "secret", "utf8");
    await symlink(outside, path.join(sessionDir, "linked.md"));

    await expect(addEvidence({
      sessionDir,
      question: "q",
      claim: "c",
      relation: "supports",
      sourcePath: "linked.md",
      offset: 0,
      limit: 1,
    })).rejects.toThrow(/outside session directory/);
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
