import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerTrajectoryRecorder } from "../src/extensions/trajectoryRecorder.js";
import { writeQueryMetadata } from "../src/observability/queryMetadata.js";

function mockPi() {
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
  const eventHandlers = new Map<string, Array<(data: any) => void>>();
  return {
    handlers,
    events: {
      on(name: string, handler: (data: any) => void) {
        const list = eventHandlers.get(name) ?? [];
        list.push(handler);
        eventHandlers.set(name, list);
      },
      emit(name: string, data: any) {
        for (const handler of eventHandlers.get(name) ?? []) handler(data);
      },
    },
    pi: {
      on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
      events: {
        on(name: string, handler: (data: any) => void) {
          const list = eventHandlers.get(name) ?? [];
          list.push(handler);
          eventHandlers.set(name, list);
        },
        emit(name: string, data: any) {
          for (const handler of eventHandlers.get(name) ?? []) handler(data);
        },
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

    const queryId = "12345678-1234-1234-1234-123456789012";
    await writeQueryMetadata(path.join(cwd, "data", "sessions", "session-1"), {
      schema_version: 1, query_id: queryId, run_id: queryId, session_id: "session-1", user_id: "u-test1234", question: "Should treatment be used?", created_at: new Date().toISOString(),
    });

    await harness.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    await harness.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "Should treatment be used?",
      systemPrompt: "private system prompt",
      systemPromptOptions: { selectedTools: ["pubmed_search"], skills: [{ name: "ebm-research" }] },
    }, ctx);
    await harness.emit("turn_start", { type: "turn_start", turnIndex: 0, timestamp: 100 }, ctx);
    harness.events.emit("ebm:system_reminder", { text: "仅用于控制研究范围", source: "research_round_hint", turn_index: 1 });
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
      result: {
        content: [{
          type: "text",
          text: "Three abstracts found\nAuthorization: Bearer oauth-secret\nOPENAI_API_KEY=sk-live-secret\nhttps://open.feishu.cn/open-apis/bot/v2/hook/private-hook-id",
        }],
        details: { resultCount: 3, refresh: "oauth-refresh-secret" },
      },
      isError: false,
    }, ctx);
    await harness.emit("before_provider_request", {
      type: "before_provider_request",
      payload: { model: "deepseek-v4-flash", messages: [{}], tools: [{}], stream: true },
    }, ctx);
    await harness.emit("after_provider_response", {
      type: "after_provider_response",
      status: 200,
      headers: { "x-request-id": "request-1" },
    }, ctx);
    await harness.emit("message_update", {
      type: "message_update",
      message: { role: "assistant" },
      assistantMessageEvent: { type: "thinking_delta", delta: "I", contentIndex: 0 },
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
      "session_start", "run_start", "turn_start", "tool_start", "tool_end", "provider_request",
      "provider_response", "model_first_delta", "assistant_message", "run_settled",
    ]));
    const runStart = lines.find((line) => line.event === "run_start");
    expect(runStart?.run_id).toBe(queryId);
    expect(runStart?.data.prompt_kind).toBe("user_query");
    expect(runStart?.data.user_id).toBe("u-test1234");
    expect(runStart?.data.user_query).toBe("Should treatment be used?");
    expect(lines.find((line) => line.event === "system_reminder")?.data.prompt_kind).toBe("system_reminder");
    expect(lines.every((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/.test(line.timestamp))).toBe(true);
    expect(lines.find((line) => line.event === "tool_start").data.args.api_key).toBe("[REDACTED]");
    expect(lines.find((line) => line.event === "assistant_message").data.content[0].thinking).toContain("compare benefit and harm");
    expect(lines.find((line) => line.event === "assistant_message").data.usage.totalTokens).toBe(200);
    expect(lines.find((line) => line.event === "tool_end").data.duration_ms).toBeGreaterThanOrEqual(0);
    expect(lines.find((line) => line.event === "tool_end").data.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(lines.find((line) => line.event === "model_first_delta").data.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(lines.find((line) => line.event === "assistant_message").data.request_timing.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(lines.find((line) => line.event === "run_settled").data.duration_seconds).toBeGreaterThanOrEqual(0);

    const markdown = await readFile(path.join(traceDir, "trajectory.md"), "utf8");
    expect(markdown).toContain("## Thinking");
    expect(markdown).toContain("I should compare benefit and harm.");
    expect(markdown).toContain("pubmed_search");
    expect(markdown).not.toContain("must-not-leak");
    expect(markdown).not.toContain("oauth-secret");
    expect(markdown).not.toContain("sk-live-secret");
    expect(markdown).not.toContain("private-hook-id");
    expect(markdown).not.toContain("oauth-refresh-secret");
  });
});
