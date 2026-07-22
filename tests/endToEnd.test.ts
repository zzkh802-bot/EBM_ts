import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveSource } from "../src/tools/archive.js";
import { addEvidence } from "../src/tools/evidence.js";
import { writeReport } from "../src/tools/report.js";
import { searchWeb } from "../src/tools/web.js";

describe("basic EBM vertical flow", () => {
  it("archives discovery, creates exact evidence, and writes a verified report", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-e2e-"));
    const fetcher = (async () => Response.json({
      results: [{
        title: "Randomized trial",
        url: "https://example.org/trial",
        content: "The intervention reduced the primary outcome.",
        score: 0.95,
      }],
    })) as typeof fetch;
    const search = await searchWeb({ sessionDir, query: "intervention trial", tavilyApiKey: "test", fetcher });
    expect(search.ok).toBe(true);
    if (!search.ok) return;

    await expect(addEvidence({
      sessionDir,
      question: "Does the intervention reduce the primary outcome?",
      claim: "The intervention reduced the primary outcome.",
      relation: "supports",
      sourcePath: search.archive.path,
      offset: search.archive.bodyLineStart,
      limit: 1,
    })).rejects.toThrow(/discovery artifacts/);

    const source = await archiveSource({
      sessionDir,
      kind: "read",
      sourceUrl: "https://example.org/trial",
      title: "Randomized trial",
      content: "# Randomized trial\n\nThe intervention reduced the primary outcome.",
    });
    const bodyLines = source.content.split("\n");
    const quoteIndex = bodyLines.indexOf("The intervention reduced the primary outcome.");
    expect(quoteIndex).toBeGreaterThanOrEqual(0);
    const evidence = await addEvidence({
      sessionDir,
      question: "Does the intervention reduce the primary outcome?",
      claim: "The intervention reduced the primary outcome.",
      relation: "supports",
      sourcePath: source.path,
      offset: source.bodyLineStart + quoteIndex,
      limit: 1,
    });
    const report = await writeReport({
      sessionDir,
      title: "Intervention evidence",
      content: `# Finding\n\nThe archived result supports the claim [Evidence ${evidence.id}](../evidence/${evidence.id}.md).`,
    });

    expect(report.evidenceIds).toEqual([evidence.id]);
    expect(await readFile(path.join(sessionDir, report.path), "utf8")).toContain("evidence_status: verified");
  });
});
