import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerStreamStallWatchdog } from "../src/extensions/streamStallWatchdog.js";

describe("stream stall watchdog extension", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("aborts print/TUI runs when a provider request stops before response headers", async () => {
    vi.stubEnv("EBM_STREAM_STALL_TIMEOUT_MS", "20");
    const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
    registerStreamStallWatchdog({
      on: (name: string, handler: (event: any, ctx: any) => any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      events: { emit: vi.fn() },
    } as never);
    const abort = vi.fn();
    const ctx = { abort, isIdle: () => false, sessionManager: { getSessionId: () => "session-1" } };
    const emit = async (name: string, event: any) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    };

    await emit("before_agent_start", {});
    await emit("before_provider_request", { payload: {} });
    await vi.advanceTimersByTimeAsync(21);

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("pauses model-stream inactivity timing while a tool executes", async () => {
    vi.stubEnv("EBM_STREAM_STALL_TIMEOUT_MS", "20");
    const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
    registerStreamStallWatchdog({
      on: (name: string, handler: (event: any, ctx: any) => any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      events: { emit: vi.fn() },
    } as never);
    const abort = vi.fn();
    const ctx = { abort, isIdle: () => false, sessionManager: { getSessionId: () => "session-1" } };
    const emit = async (name: string, event: any) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    };

    await emit("before_agent_start", {});
    await emit("after_provider_response", { status: 200, headers: {} });
    await vi.advanceTimersByTimeAsync(10);
    await emit("message_update", { assistantMessageEvent: { type: "thinking_delta" } });
    await vi.advanceTimersByTimeAsync(15);
    expect(abort).not.toHaveBeenCalled();
    await emit("tool_execution_start", { toolName: "web_read", toolCallId: "tool-1", args: {} });
    await vi.advanceTimersByTimeAsync(30);
    expect(abort).not.toHaveBeenCalled();
    await emit("tool_execution_end", { toolName: "web_read", toolCallId: "tool-1", result: {}, isError: false });
    await vi.advanceTimersByTimeAsync(21);

    expect(abort).toHaveBeenCalledTimes(1);
  });
});
