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
