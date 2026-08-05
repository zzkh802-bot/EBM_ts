import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveSource } from "../src/tools/archive.js";
import { addEvidenceFromAnchors } from "../src/tools/evidence.js";
import { listReadReceipts, registerReadReceipt, resolveReadReceipt } from "../src/tools/readRegistry.js";
import { registerReadRegistry } from "../src/extensions/readRegistry.js";
import { initializePiSessionDirectory, piReadableSessionPath } from "../src/extensions/sessionPath.js";

describe("read receipts", () => {
  it("supports concurrent reads and preserves exact preview line numbers", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const source = "header\n\nfirst evidence\nsecond evidence\n";
    const [first, second] = await Promise.all([
      registerReadReceipt({ sessionDir, sourcePath: "sources/read/a.md", source, lineStart: 3, lineEnd: 4 }),
      registerReadReceipt({ sessionDir, sourcePath: "sources/read/a.md", source, lineStart: 1, lineEnd: 3 }),
    ]);
    expect(new Set([first.id, second.id])).toEqual(new Set(["r01", "r02"]));
    const listed = await listReadReceipts(sessionDir);
    expect(listed).toHaveLength(2);
    expect(listed.find((item) => item.lineStart === 1)?.preview).toEqual([{ line: 1, text: "header" }, { line: 3, text: "first evidence" }]);
    expect(await readFile(path.join(sessionDir, "evidence", ".read-registry.json"), "utf8")).toContain('"version": 1');
  });

  it("uses read_id as a bounded exact-anchor locator", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Read receipt source", content: "Recommendation\nUse treatment when eligible." });
    const source = await readFile(path.join(sessionDir, archive.path), "utf8");
    const receipt = await registerReadReceipt({
      sessionDir,
      sourcePath: archive.path,
      source,
      lineStart: archive.bodyLineStart,
      lineEnd: archive.bodyLineStart + archive.lines - 1,
    });
    const evidence = await addEvidenceFromAnchors({
      sessionDir,
      question: "When should treatment be used?",
      claim: "Treatment is used when eligible.",
      relation: "supports",
      sourcePath: archive.path,
      readId: receipt.id,
      startText: "Use treatment",
      endText: "eligible.",
    });
    expect(evidence.quote).toBe("Use treatment when eligible.");
    await expect(resolveReadReceipt(sessionDir, "r99")).rejects.toThrow(/read_id was not found/);
  });

  it("archives anchors copied from a reflowed read view and keeps canonical source text", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({
      sessionDir,
      kind: "read",
      title: "Reflowed source",
      content: "The long-term clinical\nbenefit of treatment was confirmed.\nThe outcome improved.",
    });
    const source = await readFile(path.join(sessionDir, archive.path), "utf8");
    const receipt = await registerReadReceipt({
      sessionDir,
      sourcePath: archive.path,
      source,
      lineStart: archive.bodyLineStart,
      lineEnd: archive.bodyLineStart + archive.lines - 1,
    });
    const evidence = await addEvidenceFromAnchors({
      sessionDir,
      question: "What was the outcome?",
      claim: "Treatment improved the outcome.",
      relation: "supports",
      sourcePath: archive.path,
      readId: receipt.id,
      startText: "The long-term clinical benefit of treatment was confirmed.",
      endText: "The outcome improved.",
    });

    expect(evidence.quote).toBe("The long-term clinical\nbenefit of treatment was confirmed.\nThe outcome improved.");
    expect(evidence.matchMode).toBe("layout_normalized");
  });

  it("allows line-range mode without text anchors", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Line source", content: "Header\nThe evidence line.\nFooter" });
    const evidence = await addEvidenceFromAnchors({
      sessionDir,
      question: "What does the source say?",
      claim: "The source contains the evidence line.",
      relation: "supports",
      sourcePath: archive.path,
      lineStart: archive.bodyLineStart + 1,
      lineEnd: archive.bodyLineStart + 1,
    });

    expect(evidence.quote).toBe("The evidence line.");
    expect(evidence.matchMode).toBe("line_range");
  });

  it("uses the read receipt path when source_path is omitted", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Receipt path", content: "Use treatment when eligible." });
    const source = await readFile(path.join(sessionDir, archive.path), "utf8");
    const receipt = await registerReadReceipt({
      sessionDir,
      sourcePath: archive.path,
      source,
      lineStart: archive.bodyLineStart,
      lineEnd: archive.bodyLineStart + archive.lines - 1,
    });
    const evidence = await addEvidenceFromAnchors({
      sessionDir,
      question: "When should treatment be used?",
      claim: "Treatment is used when eligible.",
      relation: "supports",
      readId: receipt.id,
      startText: "Use treatment",
      endText: "eligible.",
    });

    expect(evidence.sourcePath).toBe(archive.path);
    expect(evidence.quote).toBe("Use treatment when eligible.");
  });

  it("does not block line-range mode when optional anchors are stale", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Stale anchors", content: "Header\nThe evidence line.\nFooter" });
    const evidence = await addEvidenceFromAnchors({
      sessionDir,
      question: "What does the source say?",
      claim: "The source contains the evidence line.",
      relation: "supports",
      sourcePath: archive.path,
      lineStart: archive.bodyLineStart + 1,
      lineEnd: archive.bodyLineStart + 1,
      startText: "stale text",
      endText: "also stale",
    });

    expect(evidence.quote).toBe("The evidence line.");
    expect(evidence.matchMode).toBe("line_range");
  });

  it("explains when a read_id is stale for the submitted anchors", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({
      sessionDir,
      kind: "read",
      title: "Multiple receipt ranges",
      content: "Abstract evidence starts here.\nAbstract evidence ends here.\n\nPubMed context starts here.",
    });
    const source = await readFile(path.join(sessionDir, archive.path), "utf8");
    const oldReceipt = await registerReadReceipt({
      sessionDir,
      sourcePath: archive.path,
      source,
      lineStart: archive.bodyLineStart + 3,
      lineEnd: archive.bodyLineStart + 3,
    });
    const abstractReceipt = await registerReadReceipt({
      sessionDir,
      sourcePath: archive.path,
      source,
      lineStart: archive.bodyLineStart,
      lineEnd: archive.bodyLineStart + 1,
    });

    await expect(addEvidenceFromAnchors({
      sessionDir,
      question: "What does the abstract say?",
      claim: "The abstract contains the evidence.",
      relation: "supports",
      readId: oldReceipt.id,
      startText: "Abstract evidence starts",
      endText: "Abstract evidence ends",
    })).rejects.toThrow(new RegExp(`当前 ${oldReceipt.id}[\\s\\S]*${abstractReceipt.id}`));
  });

  it("requires anchors when read_id mode is selected", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Receipt anchors", content: "Use treatment when eligible." });
    const source = await readFile(path.join(sessionDir, archive.path), "utf8");
    const receipt = await registerReadReceipt({
      sessionDir,
      sourcePath: archive.path,
      source,
      lineStart: archive.bodyLineStart,
      lineEnd: archive.bodyLineStart + archive.lines - 1,
    });

    await expect(addEvidenceFromAnchors({
      sessionDir,
      question: "When should treatment be used?",
      claim: "Treatment is used when eligible.",
      relation: "supports",
      readId: receipt.id,
    })).rejects.toThrow(/read_id requires both start_text and end_text/);
  });

  it("appends a receipt to the built-in read result without numbering its body", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-read-registry-"));
    const sessionId = "session-1";
    const sessionDir = await initializePiSessionDirectory(cwd, sessionId, { sessionName: "Read hook", firstPrompt: "Evidence" });
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Hook source", content: "Recommendation\nUse treatment when eligible." });
    const readablePath = piReadableSessionPath(cwd, sessionId, archive.path);
    let handler: ((event: any, ctx: any) => Promise<any>) | undefined;
    registerReadRegistry({
      registerTool: () => undefined,
      on: (_name: string, callback: (event: any, ctx: any) => Promise<any>) => { handler = callback; },
    } as never);
    const result = await handler!({
      toolName: "read",
      toolCallId: "read-1",
      input: { path: readablePath, offset: archive.bodyLineStart, limit: 2 },
      content: [{ type: "text", text: "Recommendation\nUse treatment when eligible." }],
      details: {},
      isError: false,
    }, { cwd, sessionManager: { getSessionId: () => sessionId } });
    expect(result.content[0].text).toBe("Recommendation\nUse treatment when eligible.");
    expect(result.content.at(-1).text).toMatch(/read_id: r\d+/);
  });
});
