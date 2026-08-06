import { afterEach, describe, expect, it, vi } from "vitest";
import { registerResearchRoundHint } from "../src/extensions/researchRoundHint.js";

describe("research round scope hint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("counts full-source review actions and tells the model to stop when the advisory budget is exhausted", async () => {
    vi.stubEnv("EBM_MAX_ITERATIONS", "12");
    vi.stubEnv("EBM_SOURCE_REVIEW_BUDGET", "2");
    const handlers = new Map<string, Array<(event: any) => any>>();
    registerResearchRoundHint({
      on: (name: string, handler: (event: any) => any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    } as never);
    const emit = async (name: string, event: any) => {
      let result: any;
      for (const handler of handlers.get(name) ?? []) result = await handler(event);
      return result;
    };

    await emit("before_agent_start", {});
    await emit("turn_start", { turnIndex: 3 });
    await emit("tool_execution_start", { toolName: "guideline_mcp_retrieve", args: { query: "focused chunk" } });
    await emit("tool_execution_start", { toolName: "guideline_mcp_read", args: { doc_id: "g1" } });
    await emit("tool_execution_start", { toolName: "read", args: { path: "data/sessions/s1/sources/read/g1/full.md" } });
    const result = await emit("context", { messages: [{ role: "user", content: "question", timestamp: 0 }] });
    const hint = result.messages.at(-1).content[0].text as string;

    expect(hint).toContain("第 4 个研究轮次");
    expect(hint).toContain("完整来源复核预算已用 2/2");
    expect(hint).toContain("停止继续翻阅来源");
    expect(hint).toContain("guideline_mcp_retrieve 等聚焦检索和 evidence_add 不计入");
  });
});
