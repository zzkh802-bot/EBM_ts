import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { loadProjectEnv } from "./projectEnv.js";

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type PiRpcClientOptions = {
  cliPath: string;
  cwd: string;
  env: Record<string, string>;
  provider: string;
  model: string;
  args: string[];
};

export interface PiRpcClientBase {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<{ sessionId: string; thinkingLevel: string; isStreaming: boolean }>;
  setThinkingLevel(level: PiThinkingLevel): Promise<void>;
  prompt(message: string): Promise<void>;
  waitForIdle(timeout?: number): Promise<void>;
  abort(): Promise<void>;
  getLastAssistantText(): Promise<string | null>;
}

export interface PiRpcClientLike extends PiRpcClientBase {
  onEvent(listener: (event: Record<string, unknown>) => void): () => void;
}

export type PiRpcClientFactory<TClient extends PiRpcClientBase = PiRpcClientBase> = (options: PiRpcClientOptions) => TClient;

export async function preparePiRuntime(rootDir: string, input: {
  runtimeDirectory: string;
  sessionDirectory: string;
  workspaceDirectory?: string;
}): Promise<void> {
  const root = path.resolve(rootDir);
  const runtimeDir = path.join(root, input.runtimeDirectory);
  await mkdir(runtimeDir, { recursive: true });
  await copyFile(path.join(root, ".pi", "models.json"), path.join(runtimeDir, "models.json"));
  await mkdir(path.join(root, input.sessionDirectory), { recursive: true });
  if (input.workspaceDirectory) await mkdir(path.join(root, input.workspaceDirectory), { recursive: true });
}

export async function buildPiRpcClientOptions(rootDir: string, input: {
  runtimeDirectory: string;
  sessionDirectory: string;
  workspaceDirectory?: string;
  provider: string;
  model: string;
  args: string[];
  extraEnv?: Record<string, string>;
}): Promise<PiRpcClientOptions> {
  const root = path.resolve(rootDir);
  const cliPath = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  await access(cliPath);
  await preparePiRuntime(root, input);
  return {
    cliPath,
    cwd: root,
    env: { ...(await loadProjectEnv(root)), ...(input.extraEnv ?? {}) },
    provider: input.provider,
    model: input.model,
    args: input.args,
  };
}

export function createDefaultPiRpcClient(options: PiRpcClientOptions): PiRpcClientLike {
  return new RpcClient(options) as unknown as PiRpcClientLike;
}
