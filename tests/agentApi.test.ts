import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { buildAgentPrompt, createAgentApiServer, type AgentExecutor, type AgentRunInput, type RuntimeConfig } from "../src/server/agentApi.js";

async function startApi(executor: AgentExecutor, runtimeConfig?: RuntimeConfig) {
  const api = createAgentApiServer({ executor, ...(runtimeConfig ? { runtimeConfig } : {}) });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const address = api.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
  return { api, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for API result");
}

describe("循医研究服务 API", () => {
  const promptInput = (overrides: Partial<AgentRunInput> = {}): AgentRunInput => ({
    question: "测试临床问题",
    researchMode: "instant",
    audienceMode: "clinician",
    deepThink: false,
    searchEnabled: true,
    retrievalPolicy: "all",
    maxIterations: 5,
    requestTimeoutSeconds: 300,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    ...overrides,
  });

  it("keeps report structure stable while modes change content depth", () => {
    const instant = buildAgentPrompt(promptInput());
    const expert = buildAgentPrompt(promptInput({ researchMode: "expert" }));
    const publicPrompt = buildAgentPrompt(promptInput({ audienceMode: "public" }));
    for (const prompt of [instant, expert, publicPrompt]) {
      expect(prompt).toContain("研究模式和用户类型只改变内容的深度")
      expect(prompt).toContain("关键安全结局")
      expect(prompt).toContain("必须使用独立的二级或三级标题")
      expect(prompt).toContain("在最终回复前调用 report_write")
      expect(prompt).toContain("不得只在聊天消息中输出摘要")
    }
    expect(instant).toContain("最少必要")
    expect(expert).toContain("指南推荐等级")
    expect(publicPrompt).toContain("省略 PICO、GRADE")
  });

  it("creates an async run and exposes the completed normalized response", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const executor: AgentExecutor = async (input, hooks) => {
      receivedInput = input;
      hooks.setSessionId("pi-session-1");
      hooks.onTrace({ kind: "tool.completed", label: "PubMed", timestamp: new Date().toISOString() });
      hooks.onTool({ name: "pubmed_search", status: "completed" });
      return { message: "这是可追溯的循证回答。", reportMarkdown: "# 完整循证报告\n\n正文。" };
    };
    const { api, baseUrl } = await startApi(executor);
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "类风湿关节炎患者该如何升级治疗？", research_mode: "instant" }),
      });
      expect(created.status).toBe(202);
      const accepted = await created.json() as { run_id: string; status: string; contract_version: string };
      expect(accepted.contract_version).toBe("xunyi-research/v1");
      expect(accepted.status).toBe("queued");

      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<any>,
        (value) => value.status === "succeeded",
      );
      expect(result).toMatchObject({ status: "succeeded", session_id: "pi-session-1", message: "这是可追溯的循证回答。" });
      expect(result.report_markdown).toContain("完整循证报告");
      expect(result.summary.request_timeout_seconds).toBe(300);
      expect(result.summary.retrieval_policy).toBe("all");
      expect(receivedInput?.retrievalPolicy).toBe("all");
      expect(result.agent_trace.some((event: { kind: string }) => event.kind === "tool.completed")).toBe(true);
      expect(result.tools).toContainEqual({ name: "pubmed_search", status: "completed" });
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("publishes server-configured models and sends the selected model to the executor", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const runtimeConfig: RuntimeConfig = {
      default_provider: "xinqiong",
      default_model: "deepseek-v4-flash",
      models: [
        { provider: "xinqiong", provider_label: "芯穹", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: true },
        { provider: "deepseek", provider_label: "DeepSeek", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: false },
      ],
    };
    const { api, baseUrl } = await startApi(async (input) => {
      receivedInput = input;
      return { message: "完成。" };
    }, runtimeConfig);
    try {
      const config = await fetch(`${baseUrl}/api/v1/runtime-config`);
      const published = await config.json() as RuntimeConfig;
      expect(published.default_provider).toBe("xinqiong");
      expect(published.models.find((item) => item.provider === "xinqiong")).toMatchObject({ available: true });
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请检索一个临床问题", provider: "xinqiong", model: "deepseek-v4-flash" }),
      });
      const accepted = await created.json() as { run_id: string };
      await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<any>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput).toMatchObject({ provider: "xinqiong", model: "deepseek-v4-flash" });
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("accepts the isolated MCP-only retrieval policy", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const executor: AgentExecutor = async (input) => {
      receivedInput = input;
      return { message: "仅使用 MCP 完成。" };
    };
    const { api, baseUrl } = await startApi(executor);
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请仅通过指南 MCP 回答测试问题", retrieval_policy: "mcp_only" }),
      });
      const accepted = await created.json() as { run_id: string };
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<any>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput?.retrievalPolicy).toBe("mcp_only");
      expect(result.summary.retrieval_policy).toBe("mcp_only");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("cancels a running job and rejects unsupported file attachments explicitly", async () => {
    const executor: AgentExecutor = async (_input, hooks) => new Promise((_resolve, reject) => {
      if (hooks.signal.aborted) {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
        return;
      }
      hooks.signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    const { api, baseUrl } = await startApi(executor);
    try {
      const unsupported = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "带附件的问题", attachments: [{ name: "paper.pdf" }] }),
      });
      expect(unsupported.status).toBe(422);
      expect(await unsupported.json()).toMatchObject({ error: { code: "attachments_not_supported" } });

      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请开始一个可取消任务" }),
      });
      const accepted = await created.json() as { run_id: string };
      const cancelled = await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}/cancel`, { method: "POST" });
      expect(cancelled.status).toBe(202);
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<any>,
        (value) => value.status === "cancelled",
      );
      expect(result.message).toContain("中断");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });
});
