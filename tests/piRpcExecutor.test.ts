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
    const assistant = { role: "assistant", content: [{ type: "text", text: `answer ${this.prompts.length}` }] };
    for (const listener of this.listeners) listener({ type: "message_end", message: assistant });
    for (const listener of this.listeners) listener({ type: "agent_end", messages: [assistant] });
    for (const listener of this.listeners) listener({ type: "agent_settled" });
  }
  async waitForIdle() {}
  async abort() { this.abortCount += 1; }
  async getLastAssistantText() { return `answer ${this.prompts.length}`; }
}

const request = (sessionId?: string): AgentRunInput => ({
  question: "无并发症成人普通感冒是否应使用抗生素？",
  ...(sessionId ? { sessionId } : {}),
  audienceMode: "clinician",
  thinkingLevel: "medium",
  searchEnabled: true,
  retrievalPolicy: "all",
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
});
