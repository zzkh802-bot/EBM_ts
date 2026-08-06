import { afterEach, describe, expect, it, vi } from "vitest";
import { registerResearchRoundHint } from "../src/extensions/researchRoundHint.js";

describe("research round scope hint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps source retrieval and evidence registration in the normal research stage", async () => {
    vi.stubEnv("EBM_MAX_ITERATIONS", "12");
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
    const result = await emit("context", { messages: [{ role: "user", content: "question", timestamp: 0 }] });
    const hint = result.messages.at(-1).content[0].text as string;

    expect(hint).toContain("第 4 个研究轮次");
    expect(hint).toContain("读取、核验和证据登记都属于当前研究阶段");
    expect(hint).not.toContain("完整来源复核预算");
  });
});
