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
  const projectEnv = await loadProjectEnv(root);
  const env = allowlistedPiEnvironment(projectEnv, input.provider);
  return {
    cliPath,
    cwd: root,
    env: { ...env, ...(input.extraEnv ?? {}) },
    provider: input.provider,
    model: input.model,
    args: input.args,
  };
}

const SHARED_SAFE_ENV_KEYS = [
  "NCBI_EMAIL", "NCBI_API_KEY", "TAVILY_API_KEY", "JINA_API_KEY", "JINA_READER_BASE_URL", "FIRECRAWL_API_KEY",
  "WEB_READ_REQUEST_TIMEOUT_MS", "WEB_READ_TOTAL_TIMEOUT_MS", "PDF_MAX_PAGES_FOR_WEB_READ", "SOURCE_LIBRARY_DIR",
  "GUIDELINE_MCP_URL", "GUIDELINE_MCP_TIMEOUT_MS", "MINERU_API_TOKEN", "MINERU_V4_BASE_URL",
  "XINQIONG_API_KEY", "XINQIONG_BASE_URL", "XINQIONG_VISION_MODEL",
] as const;

export function allowlistedPiEnvironment(projectEnv: Record<string, string>, provider: string): Record<string, string> {
  const keys = new Set<string>(SHARED_SAFE_ENV_KEYS);
  for (const key of providerSecretKeys(provider)) keys.add(key);
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = projectEnv[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function providerSecretKeys(provider: string): readonly string[] {
  switch (provider) {
    case "deepseek": return ["DEEPSEEK_API_KEY"];
    case "xinqiong": return ["XINQIONG_API_KEY", "OPENAI_API_KEY"];
    case "openai": return ["OPENAI_API_KEY"];
    case "anthropic": return ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"];
    case "openai-codex": return [];
    default: return [];
  }
}

export function createDefaultPiRpcClient(options: PiRpcClientOptions): PiRpcClientLike {
  return new RpcClient(options) as unknown as PiRpcClientLike;
}
