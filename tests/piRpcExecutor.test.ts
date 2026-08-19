import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPiRpcExecutor,
  type AgentExecutionHooks,
  type AgentRunInput,
  type PiRpcClientLike,
} from "../src/server/agentApi.js";
import { piSessionDirectory } from "../src/extensions/sessionPath.js";

class FakeRpcClient implements PiRpcClientLike {
  private listeners = new Set<(event: Record<string, unknown>) => void>();
  readonly prompts: string[] = [];
  readonly thinkingLevels: string[] = [];
  abortCount = 0;
  started = false;
  stopped = false;
  writeReport = true;

  constructor(private readonly sessionId: string, private readonly rootDir: string) {}

  async start() { this.started = true; }
  async stop() { this.stopped = true; }
  onEvent(listener: (event: Record<string, unknown>) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async getState() {
    return { sessionId: this.sessionId, thinkingLevel: this.thinkingLevels.at(-1) ?? "high", isStreaming: false };
  }
  async setThinkingLevel(level: string) { this.thinkingLevels.push(level); }
  async prompt(message: string) {
    this.prompts.push(message);
    const workspace = piSessionDirectory(this.rootDir, this.sessionId);
    await mkdir(path.join(workspace, "reports"), { recursive: true });
    if (this.writeReport) {
      await writeFile(path.join(workspace, "reports", "verified.md"), `# Verified report ${this.prompts.length}\n`, "utf8");
    }
    for (const listener of this.listeners) listener({ type: "tool_execution_start", toolName: "pubmed_search", toolCallId: "call-1", args: { query: "common cold" } });
    for (const listener of this.listeners) listener({ type: "tool_execution_end", toolName: "pubmed_search", toolCallId: "call-1", result: "found candidate study", isError: false });
    const assistant = { role: "assistant", content: [{ type: "text", text: `answer ${this.prompts.length}` }] };
    for (const listener of this.listeners) listener({ type: "message_end", message: assistant });
    for (const listener of this.listeners) listener({ type: "agent_end", messages: [assistant] });
    for (const listener of this.listeners) listener({ type: "agent_settled" });
  }
  async waitForIdle() {}
  async abort() { this.abortCount += 1; }
  async getLastAssistantText() { return `answer ${this.prompts.length}`; }
}

class StallingRpcClient implements PiRpcClientLike {
  private listeners = new Set<(event: Record<string, unknown>) => void>();
  private rejectIdle?: (error: Error) => void;
  abortCount = 0;

  constructor(private readonly sessionId: string) {}
  async start() {}
  async stop() {}
  onEvent(listener: (event: Record<string, unknown>) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async getState() { return { sessionId: this.sessionId, thinkingLevel: "medium", isStreaming: false }; }
  async setThinkingLevel() {}
  async prompt() {
    for (const listener of this.listeners) listener({ type: "agent_start" });
    for (const listener of this.listeners) listener({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "checking" } });
  }
  async waitForIdle() {
    return new Promise<void>((_resolve, reject) => {
      this.rejectIdle = reject;
      setTimeout(() => reject(new Error("fake idle timeout")), 100);
    });
  }
  async abort() {
    this.abortCount += 1;
    this.rejectIdle?.(new Error("aborted"));
  }
  async getLastAssistantText() { return null; }
}

const request = (sessionId?: string): AgentRunInput => ({
  question: "无并发症成人普通感冒是否应使用抗生素？",
  ...(sessionId ? { sessionId } : {}),
  audienceMode: "clinician",
  thinkingLevel: "medium",
  searchEnabled: true,
  retrievalPolicy: "all",
  responseMode: "report",
  maxIterations: 32,
  requestTimeoutSeconds: 600,
  provider: "deepseek",
  model: "deepseek-v4-flash",
});

const hooks = (signal = new AbortController().signal): AgentExecutionHooks => ({
  signal,
  setSessionId: () => undefined,
  onTrace: () => undefined,
  onProgress: () => undefined,
  onTool: () => undefined,
});

describe("Pi RPC clinician executor", () => {
  it("aborts a model stream that stops producing activity before the total request timeout", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-rpc-stall-"));
    const cli = path.join(rootDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "", "utf8");
    await mkdir(path.join(rootDir, ".pi"), { recursive: true });
    await writeFile(path.join(rootDir, ".pi", "models.json"), "{}\n", "utf8");
    const client = new StallingRpcClient("rpc-stall-1");
    const trace: string[] = [];
    const executor = createPiRpcExecutor({
      rootDir,
      clientFactory: () => client,
      streamStallTimeoutMs: 10,
    });

    await expect(executor(request(), {
      ...hooks(),
      onTrace: (event) => trace.push(event.kind),
    })).rejects.toThrow(/model stream stalled/i);
    expect(client.abortCount).toBe(1);
    expect(trace).toContain("runtime.stream_stalled");
    await executor.dispose();
  });

  it("loads separate skills for quick and expert mode", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-rpc-skills-"));
    const cli = path.join(rootDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "", "utf8");
    await mkdir(path.join(rootDir, ".pi"), { recursive: true });
    await writeFile(path.join(rootDir, ".pi", "models.json"), "{}\n", "utf8");
    const argumentsByMode: string[][] = [];
    const executor = createPiRpcExecutor({
      rootDir,
      clientFactory: (options) => {
        argumentsByMode.push(options.args);
        return new FakeRpcClient("rpc-skills-client", rootDir);
      },
    });

    await executor(request(), hooks());
    await executor({ ...request(), researchMode: "quick", responseMode: "answer", thinkingLevel: "low", maxIterations: 8 }, hooks());

    const expertArgs = argumentsByMode[0]!.join(" ");
    const quickArgs = argumentsByMode[1]!.join(" ");
    expect(expertArgs).toContain("ebm-research");
    expect(expertArgs).toContain("clinical-report-writing");
    expect(expertArgs).not.toContain("quick-ebm-answer");
    expect(quickArgs).toContain("quick-ebm-answer");
    expect(quickArgs).not.toContain("ebm-research");
    expect(quickArgs).not.toContain("clinical-report-writing");
    await executor.dispose();
  });

  it("keeps one native RPC process for consecutive turns in the same session", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-rpc-"));
    const cli = path.join(rootDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "", "utf8");
    await mkdir(path.join(rootDir, ".pi"), { recursive: true });
    await writeFile(path.join(rootDir, ".pi", "models.json"), "{}\n", "utf8");
    const clients: FakeRpcClient[] = [];
    const executor = createPiRpcExecutor({
      rootDir,
      clientFactory: () => {
        const client = new FakeRpcClient("rpc-session-1", rootDir);
        clients.push(client);
        return client;
      },
    });

    const first = await executor(request(), hooks());
    const second = await executor(request(first.sessionId), hooks());

    expect(clients).toHaveLength(1);
    expect(clients[0]?.prompts).toHaveLength(2);
    expect(clients[0]?.thinkingLevels).toEqual(["medium", "medium"]);
    expect(first).toMatchObject({ sessionId: "rpc-session-1", message: "answer 1", reportPath: "reports/verified.md" });
    expect(second).toMatchObject({ sessionId: "rpc-session-1", message: "answer 2", reportMarkdown: "# Verified report 2" });

    clients[0]!.writeReport = false;
    await expect(executor(request(first.sessionId), hooks())).rejects.toThrow(/本轮正式报告未生成或未更新/);

    await executor.dispose();
    expect(clients[0]?.stopped).toBe(true);
  });

  it("projects native tool lifecycle events into the typed execution hooks", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-rpc-events-"));
    const cli = path.join(rootDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "", "utf8");
    await mkdir(path.join(rootDir, ".pi"), { recursive: true });
    await writeFile(path.join(rootDir, ".pi", "models.json"), "{}\n", "utf8");
    const executor = createPiRpcExecutor({
      rootDir,
      clientFactory: () => new FakeRpcClient("rpc-events-1", rootDir),
    });
    const trace: Array<{ kind: string; label: string }> = [];
    const tools: Array<Record<string, unknown>> = [];
    const result = await executor(request(), {
      signal: new AbortController().signal,
      setSessionId: () => undefined,
      onTrace: (event) => trace.push({ kind: event.kind, label: event.label }),
      onProgress: () => undefined,
      onTool: (event) => tools.push(event),
    });

    expect(result.message).toBe("answer 1");
    expect(tools).toEqual([
      expect.objectContaining({ id: "call-1", name: "pubmed_search", status: "running" }),
      expect.objectContaining({ id: "call-1", name: "pubmed_search", status: "completed", result: "found candidate study" }),
    ]);
    expect(trace.map((event) => event.kind)).toContain("tool.started");
    expect(trace.map((event) => event.kind)).toContain("tool.completed");
    await executor.dispose();
  });
});
