import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerContextPruner } from "../src/extensions/contextPruner.js";
import { initializePiSessionDirectory } from "../src/extensions/sessionPath.js";
import { pruneLargeToolResults } from "../src/tools/contextPrune.js";

function entry(id: string, text: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: `call-${id}`,
      toolName: "pubmed_search",
      content: [{ type: "text", text }],
    },
  });
}

describe("context tool-result pruning", () => {
  it("archives large tool results and leaves a short model-visible preview", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-prune-"));
    const sessionFile = path.join(dir, "session.jsonl");
    const large = `${"x".repeat(5000)}\nimportant tail`;
    await writeFile(sessionFile, `${entry("abc123", large)}\n`, "utf8");

    const result = await pruneLargeToolResults({
      sessionFile,
      sessionDir: dir,
      readableSessionWorkspace: "data/sessions/demo",
      maxPreviewChars: 200,
      minTextChars: 4000,
    });

    expect(result.pruned).toBe(1);
    const pruned = await readFile(sessionFile, "utf8");
    expect(pruned).toContain("[EBM_CONTEXT_PRUNED]");
    expect(pruned).toContain("Full archived result: data/sessions/demo/context_prune/tool-results/");
    expect(pruned).not.toContain("important tail");
    const archive = await readFile(path.join(dir, result.archived[0]!.path), "utf8");
    expect(archive).toContain("important tail");
  });

  it("does not prune already-pruned or small tool results", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ebm-prune-"));
    const sessionFile = path.join(dir, "session.jsonl");
    await writeFile(sessionFile, `${entry("small", "short")}\n${entry("done", "[EBM_CONTEXT_PRUNED]\nold")}\n`, "utf8");
    const result = await pruneLargeToolResults({ sessionFile, sessionDir: dir, readableSessionWorkspace: "data/sessions/demo" });
    expect(result.pruned).toBe(0);
  });

  it("runs the 250k pruning pass only once per session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-prune-ext-"));
    const sessionId = "session-1";
    const workspace = await initializePiSessionDirectory(cwd, sessionId, { firstPrompt: "large session" });
    const piSessionDir = path.join(cwd, "pi-sessions");
    await mkdir(piSessionDir, { recursive: true });
    const sessionFile = path.join(piSessionDir, "session.jsonl");
    await writeFile(sessionFile, `${JSON.stringify({ type: "session", id: sessionId, timestamp: "2026", cwd })}\n${entry("large", "x".repeat(5000))}\n`, "utf8");
    const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
    const events: Array<[string, any]> = [];
    registerContextPruner({
      on: (name: string, handler: (event: any, ctx: any) => Promise<void> | void) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      events: { emit: (name: string, payload: any) => events.push([name, payload]) },
    } as never);
    const ctx = {
      cwd,
      getContextUsage: () => ({ tokens: 250_000, contextWindow: 466_384, percent: 53.6 }),
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionFile: () => sessionFile,
        getSessionDir: () => piSessionDir,
      },
    };

    for (const handler of handlers.get("agent_settled") ?? []) await handler({ type: "agent_settled" }, ctx);
    for (const handler of handlers.get("agent_settled") ?? []) await handler({ type: "agent_settled" }, ctx);

    expect(events.filter(([name]) => name === "ebm:context_pruned")).toHaveLength(1);
    await expect(readFile(path.join(workspace, "context_prune", ".pruned-at-250k"), "utf8")).resolves.toContain("+08:00");
  });
});
