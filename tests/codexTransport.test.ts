import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOpenAICodexWebSocketDebugStats,
  resetOpenAICodexWebSocketDebugStats,
  stream,
} from "../node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js";

const sessionId = "codex-transport-regression";
const model = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-codex-responses" as const,
  provider: "openai-codex",
  baseUrl: "https://example.invalid/backend-api",
  reasoning: true,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};
const context = { messages: [{ role: "user" as const, content: "test", timestamp: 0 }] };
const token = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.x`;

afterEach(() => {
  resetOpenAICodexWebSocketDebugStats(sessionId);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Codex transport recovery", () => {
  it("retries WebSocket after the fallback cooldown and never hides explicit WebSocket failures behind SSE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let websocketAttempts = 0;
    class FailingWebSocket {
      private readonly listeners = new Map<string, (event: { message: string }) => void>();

      constructor() {
        websocketAttempts += 1;
        queueMicrotask(() => this.listeners.get("error")?.({ message: "simulated websocket outage" }));
      }

      addEventListener(type: string, listener: (event: { message: string }) => void) { this.listeners.set(type, listener); }
      removeEventListener(type: string, listener: (event: { message: string }) => void) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
      }
      close() {}
    }
    const fetchMock = vi.fn(async () => new Response("simulated SSE fallback", { status: 500, statusText: "Server Error" }));
    vi.stubGlobal("WebSocket", FailingWebSocket);
    vi.stubGlobal("fetch", fetchMock);

    await stream(model, context, { apiKey: token, sessionId, transport: "auto" }).result();
    vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));
    await stream(model, context, { apiKey: token, sessionId, transport: "auto" }).result();
    await stream(model, context, { apiKey: token, sessionId, transport: "websocket" }).result();

    expect(websocketAttempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getOpenAICodexWebSocketDebugStats(sessionId)?.websocketFailures).toBe(2);
  });
});
