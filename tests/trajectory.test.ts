import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerTrajectoryRecorder } from "../src/extensions/trajectoryRecorder.js";

function mockPi() {
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
  return {
    handlers,
    pi: {
      on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
    },
    async emit(name: string, event: any, ctx: any) {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    },
  };
}

describe("developer trajectory recorder", () => {
  it("records complete thinking and tool timing outside Pi session context", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-trajectory-"));
    const harness = mockPi();
    registerTrajectoryRecorder(harness.pi as never);
    const ctx = {
      cwd,
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      sessionManager: { getSessionId: () => "session-1" },
      getContextUsage: () => ({ tokens: 1200, contextWindow: 128000, percent: 0.94 }),
    };

    await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Should treatment be used?",
      systemPrompt: "private system prompt",
      systemPromptOptions: { selectedTools: ["pubmed_search"], skills: [{ name: "ebm-research" }] },
    }, ctx);
    await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 100 }, ctx);
    await harness.emit("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "pubmed_search",
      args: { query: "aspirin", api_key: "must-not-leak" },
    }, ctx);
    await harness.emit("tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "pubmed_search",
      result: { content: [{ type: "text", text: "Three abstracts found" }], details: { resultCount: 3 } },
      isError: false,
    }, ctx);
    await harness.emit("message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should compare benefit and harm." },
          { type: "text", text: "The evidence is conditional." },
        ],
        provider: "deepseek",
        model: "deepseek-v4-flash",
        stopReason: "stop",
        usage: { input: 100, output: 40, cacheRead: 60, cacheWrite: 0, totalTokens: 200, cost: { total: 0 } },
        timestamp: 200,
      },
    }, ctx);
    await harness.emit("agent_settled", { type: "agent_settled" }, ctx);

    const traceDir = path.join(cwd, "data", "sessions", "session-1", "trace");
    const lines = (await readFile(path.join(traceDir, "trajectory.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.event)).toEqual(expect.arrayContaining([
      "session_start", "run_start", "turn_start", "tool_start", "tool_end", "assistant_message", "run_settled",
    ]));
    expect(lines.find((line) => line.event === "tool_start").data.args.api_key).toBe("[REDACTED]");
    expect(lines.find((line) => line.event === "assistant_message").data.content[0].thinking).toContain("compare benefit and harm");
    expect(lines.find((line) => line.event === "assistant_message").data.usage.totalTokens).toBe(200);
    expect(lines.find((line) => line.event === "tool_end").data.duration_ms).toBeGreaterThanOrEqual(0);

    const markdown = await readFile(path.join(traceDir, "trajectory.md"), "utf8");
    expect(markdown).toContain("## Thinking");
    expect(markdown).toContain("I should compare benefit and harm.");
    expect(markdown).toContain("pubmed_search");
    expect(markdown).not.toContain("must-not-leak");
  });
});
