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

  it("makes quick mode answer from current sources at the eighth round without a hard process stop", async () => {
    vi.stubEnv("EBM_RESEARCH_MODE", "quick");
    vi.stubEnv("EBM_MAX_ITERATIONS", "8");
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
    await emit("turn_start", { turnIndex: 7 });
    const result = await emit("context", { messages: [{ role: "user", content: "question", timestamp: 0 }] });
    const hint = result.messages.at(-1).content[0].text as string;

    expect(hint).toContain("第 8 个研究轮次");
    expect(hint).toContain("第 8 轮收束点");
    expect(hint).toContain("不得开始新的检索或阅读");
    expect(hint).toContain("仍要作答");
  });

  it("moves the quick-mode closing point to the configured three-round patient budget", async () => {
    vi.stubEnv("EBM_RESEARCH_MODE", "quick");
    vi.stubEnv("EBM_MAX_ITERATIONS", "3");
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
    await emit("turn_start", { turnIndex: 1 });
    const open = await emit("context", { messages: [{ role: "user", content: "question", timestamp: 0 }] });
    expect(open.messages.at(-1).content[0].text as string).not.toContain("收束点");

    await emit("turn_start", { turnIndex: 2 });
    const closing = await emit("context", { messages: [{ role: "user", content: "question", timestamp: 0 }] });
    const hint = closing.messages.at(-1).content[0].text as string;

    expect(hint).toContain("建议预算为 3 轮");
    expect(hint).toContain("第 3 轮收束点");
    expect(hint).toContain("不得开始新的检索或阅读");
    expect(hint).toContain("仍要作答");
  });

});
