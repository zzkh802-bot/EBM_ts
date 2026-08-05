import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { initResearchFrame } from "../tools/researchFrame.js";
import { initializePiSessionDirectory, piSessionDirectory } from "../session/sessionPath.js";
import { PatientIntakeError, type PatientIntakeExecutor, PatientWorkspace, validatePatientIntakeInput } from "./patientIntake.js";
import { PiRpcSessionPool } from "./piRpcPool.js";
import { buildPiRpcClientOptions, createDefaultPiRpcClient, preparePiRuntime, type PiRpcClientLike, type PiRpcClientOptions } from "./piRuntime.js";
import { loadProjectEnv } from "./projectEnv.js";
import { readCitationDetail } from "./citationService.js";
import { listWorkspaceFiles, readWorkspaceFile, sessionWorkspace, WorkspaceServiceError } from "./workspaceService.js";
import { readFinalReportRevisions } from "./reportPublication.js";
import { InternalAuthStore } from "./internalAuth.js";
import { SessionOwnershipError, SessionOwnershipStore } from "./sessionOwnership.js";

const CONTRACT_VERSION = "xunyi-research/v1";
const PATIENT_CONTRACT_VERSION = "xunyi-patient/v1";
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_TRACE_EVENTS = 240;
const MAX_TOOL_EVENTS = 160;
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 90_000;

export type AgentRunStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
export type ResearchStage = "idle" | "planning" | "retrieving" | "tooling" | "generating" | "network_wait";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AudienceMode = "clinician" | "public";
export type RetrievalPolicy = "all" | "mcp_only";

export type AgentTraceEvent = {
  kind: string;
  label: string;
  detail?: string;
  timestamp: string;
};

/** A user-facing note emitted by Pi before it performs one or more tool calls. */
export type ResearchProgressUpdate = {
  text: string;
  timestamp: string;
};

export type AgentRunInput = {
  question: string;
  sessionId?: string;
  audienceMode: AudienceMode;
  thinkingLevel: ThinkingLevel;
  searchEnabled: boolean;
  retrievalPolicy: RetrievalPolicy;
  maxIterations: number;
  requestTimeoutSeconds: number;
  provider: string;
  model: string;
};

export type RuntimeModel = {
  provider: string;
  provider_label: string;
  model: string;
  model_label: string;
  available: boolean;
  setup_hint?: string;
  connection_provider?: string;
};

export type RuntimeConfig = {
  default_provider: string;
  default_model: string;
  models: RuntimeModel[];
};

type AccountConnectionStatus = "waiting" | "connected" | "failed" | "cancelled";
type AccountConnection = {
  id: string;
  provider: "openai-codex" | "anthropic";
  status: AccountConnectionStatus;
  message: string;
  createdAt: number;
  authorization?: { url?: string; instructions?: string; device_code?: string; verification_url?: string };
  prompt?: { type: "text" | "select" | "manual_code"; message: string; placeholder?: string; options?: Array<{ id: string; label: string; description?: string }> };
  resolvePrompt?: (value: string) => void;
  controller: AbortController;
};

export type AgentExecutionResult = {
  sessionId?: string;
  message: string;
  reportMarkdown?: string;
  reportPath?: string;
  agentTrace?: AgentTraceEvent[];
  progressUpdates?: ResearchProgressUpdate[];
  tools?: Array<Record<string, unknown>>;
  stderr?: string;
};

export type AgentExecutionHooks = {
  signal: AbortSignal;
  setSessionId: (sessionId: string) => void;
  onTrace: (event: AgentTraceEvent) => void;
  onProgress: (update: ResearchProgressUpdate) => void;
  onTool: (event: Record<string, unknown>) => void;
};

export type AgentExecutor = (input: AgentRunInput, hooks: AgentExecutionHooks) => Promise<AgentExecutionResult>;

export type { PiRpcClientOptions, PiRpcClientLike } from "./piRuntime.js";

export type PiRpcExecutor = AgentExecutor & { dispose(): Promise<void> };

export type AgentRunResponse = {
  contract_version: string;
  run_id: string;
  status: AgentRunStatus;
  stage: ResearchStage;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  session_id?: string;
  message: string;
  agent_answer?: string;
  report_markdown?: string;
  report_path?: string;
  patient_summary?: string;
  agent_trace: AgentTraceEvent[];
  progress_updates: ResearchProgressUpdate[];
  tools: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  error?: { code: string; message: string };
};

type InternalRun = {
  id: string;
  input: AgentRunInput;
  status: AgentRunStatus;
  stage: ResearchStage;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  sessionId?: string;
  message: string;
  reportMarkdown?: string;
  reportPath?: string;
  agentTrace: AgentTraceEvent[];
  progressUpdates: ResearchProgressUpdate[];
  tools: Array<Record<string, unknown>>;
  error?: { code: string; message: string };
  controller: AbortController;
  ownerId?: string;
};

export class AgentRunStore {
  private readonly runs = new Map<string, InternalRun>();

  constructor(private readonly executor: AgentExecutor, private readonly maxCompletedRuns = 100, private readonly onSessionId?: (sessionId: string, ownerId?: string) => void) {}

  submit(input: AgentRunInput, ownerId?: string): AgentRunResponse {
    this.pruneCompletedRuns();
    const run: InternalRun = {
      id: randomUUID(),
      input,
      status: "queued",
      stage: "planning",
      createdAt: new Date().toISOString(),
      message: "任务已创建，等待循证研究服务运行。",
      agentTrace: [trace("run.queued", "任务已创建", "等待研究引擎启动")],
      progressUpdates: [],
      tools: [],
      controller: new AbortController(),
      ...(ownerId ? { ownerId } : {}),
    };
    this.runs.set(run.id, run);
    queueMicrotask(() => void this.execute(run));
    return this.toResponse(run);
  }

  get(runId: string, ownerId?: string): AgentRunResponse | undefined {
    const run = this.runs.get(runId);
    return run && (!ownerId || run.ownerId === ownerId) ? this.toResponse(run) : undefined;
  }

  cancel(runId: string, ownerId?: string): AgentRunResponse | undefined {
    const run = this.runs.get(runId);
    if (!run || (ownerId && run.ownerId !== ownerId)) return undefined;
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return this.toResponse(run);
    run.status = "cancelling";
    run.message = "已请求中断任务，正在停止 Agent 进程。";
    this.addTrace(run, trace("run.cancelling", "正在中断", "浏览器请求停止当前任务"));
    run.controller.abort(new Error("Run cancelled by client"));
    return this.toResponse(run);
  }

  private async execute(run: InternalRun): Promise<void> {
    if (run.controller.signal.aborted) {
      this.markCancelled(run);
      return;
    }
    run.status = "running";
    run.stage = "retrieving";
    run.startedAt = new Date().toISOString();
    run.message = "循证研究服务正在检索和生成回答。";
    this.addTrace(run, trace("run.started", "任务已启动", `推理强度：${run.input.thinkingLevel}`));
    try {
      const result = await this.executor(run.input, {
        signal: run.controller.signal,
        setSessionId: (sessionId) => {
          run.sessionId = sessionId;
          this.onSessionId?.(sessionId, run.ownerId);
        },
        onTrace: (event) => this.addTrace(run, event),
        onProgress: (update) => this.addProgress(run, update),
        onTool: (event) => this.addTool(run, event),
      });
      if (run.controller.signal.aborted) {
        this.markCancelled(run);
        return;
      }
      if (result.sessionId) run.sessionId = result.sessionId;
      if (result.reportMarkdown) run.reportMarkdown = result.reportMarkdown;
      if (result.reportPath) run.reportPath = result.reportPath;
      for (const event of result.agentTrace ?? []) this.addTrace(run, event);
      for (const update of result.progressUpdates ?? []) this.addProgress(run, update);
      for (const tool of result.tools ?? []) this.addTool(run, tool);
      run.status = "succeeded";
      run.stage = "idle";
      run.completedAt = new Date().toISOString();
      run.message = result.message.trim() || "Agent 已完成，但没有生成可展示的文本。";
      this.addTrace(run, trace("run.completed", "任务完成", "已收到最终回答"));
    } catch (error) {
      if (run.controller.signal.aborted || isAbortError(error)) {
        this.markCancelled(run);
        return;
      }
      run.status = "failed";
      run.stage = "idle";
      run.completedAt = new Date().toISOString();
      run.message = "循证研究服务未能完成本次任务。";
      run.error = { code: "agent_execution_failed", message: errorMessage(error) };
      this.addTrace(run, trace("run.failed", "任务失败", run.error.message));
    }
  }

  private markCancelled(run: InternalRun): void {
    run.status = "cancelled";
    run.stage = "idle";
    run.completedAt = new Date().toISOString();
    run.message = "任务已中断。";
    this.addTrace(run, trace("run.cancelled", "任务已中断", "研究引擎已收到取消信号"));
  }

  private addTrace(run: InternalRun, event: AgentTraceEvent): void {
    if (event.kind === "tool.started") run.stage = event.label.includes("report") ? "generating" : "tooling";
    if (event.kind === "model.error" || event.kind === "run.cancelling" || event.kind === "runtime.stream_stalled" || event.kind === "runtime.request_timed_out") run.stage = "network_wait";
    run.agentTrace.push(event);
    if (run.agentTrace.length > MAX_TRACE_EVENTS) run.agentTrace.splice(0, run.agentTrace.length - MAX_TRACE_EVENTS);
  }

  private addTool(run: InternalRun, event: Record<string, unknown>): void {
    const name = typeof event.name === "string" ? event.name : "";
    if (event.status === "running") run.stage = name === "report_write" || name === "report_finalize" ? "generating" : "tooling";
    const id = typeof event.id === "string" ? event.id : undefined;
    const existing = id ? run.tools.findIndex((item) => item.id === id) : -1;
    if (existing >= 0) run.tools[existing] = { ...run.tools[existing], ...event };
    else run.tools.push(event);
    if (run.tools.length > MAX_TOOL_EVENTS) run.tools.splice(0, run.tools.length - MAX_TOOL_EVENTS);
  }

  private addProgress(run: InternalRun, update: ResearchProgressUpdate): void {
    const text = update.text.trim();
    if (!text) return;
    const previous = run.progressUpdates.at(-1);
    if (previous?.text === text) return;
    run.progressUpdates.push({ text, timestamp: update.timestamp });
  }

  private toResponse(run: InternalRun): AgentRunResponse {
    const completed = run.status === "succeeded";
    return {
      contract_version: CONTRACT_VERSION,
      run_id: run.id,
      status: run.status,
      stage: run.stage,
      created_at: run.createdAt,
      ...(run.startedAt ? { started_at: run.startedAt } : {}),
      ...(run.completedAt ? { completed_at: run.completedAt } : {}),
      ...(run.sessionId ? { session_id: run.sessionId } : {}),
      message: run.message,
      ...(completed ? {
        agent_answer: run.message,
        patient_summary: run.message,
        ...(run.reportMarkdown ? { report_markdown: run.reportMarkdown } : {}),
        ...(run.reportPath ? { report_path: run.reportPath } : {}),
      } : {}),
      agent_trace: [...run.agentTrace],
      progress_updates: [...run.progressUpdates],
      tools: [...run.tools],
      summary: {
        audience_mode: run.input.audienceMode,
        thinking_level: run.input.thinkingLevel,
        search_enabled: run.input.searchEnabled,
        retrieval_policy: run.input.retrievalPolicy,
        max_iterations: run.input.maxIterations,
        max_iterations_is_advisory: true,
        request_timeout_seconds: run.input.requestTimeoutSeconds,
        provider: run.input.provider,
        model: run.input.model,
      },
      ...(run.error ? { error: run.error } : {}),
    };
  }

  private pruneCompletedRuns(): void {
    const completed = [...this.runs.values()]
      .filter((run) => ["succeeded", "failed", "cancelled"].includes(run.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const excess = completed.length - this.maxCompletedRuns + 1;
    for (const run of completed.slice(0, Math.max(0, excess))) this.runs.delete(run.id);
  }
}

export type AgentApiServerOptions = {
  executor: AgentExecutor;
  patientIntakeExecutor?: PatientIntakeExecutor;
  corsOrigin?: string;
  maxCompletedRuns?: number;
  runtimeConfig?: RuntimeConfig | (() => Promise<RuntimeConfig>);
  accountConnections?: AccountConnectionStore;
  staticDir?: string;
  rootDir?: string;
  internalAccessKey?: string;
};

export function createAgentApiServer(options: AgentApiServerOptions): { server: Server; store: AgentRunStore } {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const auth = new InternalAuthStore(options.internalAccessKey);
  const ownership = new SessionOwnershipStore(rootDir);
  const store = new AgentRunStore(options.executor, options.maxCompletedRuns, (sessionId, ownerId) => {
    if (ownerId) void ownership.claim(sessionId, ownerId).catch(() => undefined);
  });
  const configuredRuntimeConfig = options.runtimeConfig;
  const runtimeConfig = typeof configuredRuntimeConfig === "function"
    ? configuredRuntimeConfig
    : async () => configuredRuntimeConfig ?? defaultRuntimeConfig();
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : undefined;
  const patientWorkspace = new PatientWorkspace(rootDir);
  const server = createServer((request, response) => {
    void handleRequest(request, response, store, options.corsOrigin ?? "*", runtimeConfig, options.accountConnections, options.patientIntakeExecutor, patientWorkspace, staticDir, rootDir, auth, ownership);
  });
  return { server, store };
}

export async function loadRuntimeConfig(rootDir: string): Promise<RuntimeConfig> {
  const env = { ...(await loadProjectEnv(rootDir)), ...process.env };
  const accountAuth = await subscriptionAuthStatus(rootDir);
  const models: RuntimeModel[] = [
    {
      provider: "xinqiong", provider_label: "芯穹 / Infini-AI", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash",
      available: Boolean(env.XINQIONG_API_KEY || (env.EBM_PROVIDER === "xinqiong" && env.OPENAI_API_KEY)),
      setup_hint: "设置 XINQIONG_API_KEY；旧配置可继续使用 EBM_PROVIDER=xinqiong 与 OPENAI_API_KEY。",
    },
    {
      provider: "deepseek", provider_label: "DeepSeek", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash",
      available: Boolean(env.DEEPSEEK_API_KEY), setup_hint: "设置 DEEPSEEK_API_KEY。",
    },
    {
      provider: "openai", provider_label: "OpenAI", model: "gpt-5-mini", model_label: "GPT-5 mini",
      available: env.EBM_ENABLE_OPENAI === "1" && Boolean(env.OPENAI_API_KEY), setup_hint: "设置 OPENAI_API_KEY，并显式设置 EBM_ENABLE_OPENAI=1。",
    },
    {
      provider: "anthropic", provider_label: "Anthropic", model: "claude-sonnet-4-5", model_label: "Claude Sonnet 4.5",
      available: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_OAUTH_TOKEN || accountAuth.anthropic),
      setup_hint: "设置 ANTHROPIC_API_KEY，或连接 Claude 订阅账户。", connection_provider: "anthropic",
    },
    {
      provider: "openai-codex", provider_label: "ChatGPT 订阅", model: "gpt-5.5", model_label: "GPT-5.5",
      available: accountAuth.openaiCodex, setup_hint: "连接 ChatGPT Plus 或 Pro 账户。", connection_provider: "openai-codex",
    },
  ];
  const configuredDefault = models.find((item) => item.provider === env.EBM_PROVIDER && item.model === (env.EBM_MODEL || item.model));
  const fallback = configuredDefault ?? models.find((item) => item.available) ?? models[0]!;
  return {
    default_provider: fallback.provider,
    default_model: fallback.model,
    models,
  };
}

export class AccountConnectionStore {
  private static readonly maxRetainedConnections = 32;
  private static readonly completedRetentionMs = 15 * 60 * 1_000;
  private readonly connections = new Map<string, AccountConnection>();

  constructor(private readonly rootDir: string) {}

  async start(provider: string): Promise<AccountConnection> {
    this.pruneConnections();
    if (provider !== "openai-codex" && provider !== "anthropic") {
      throw new ApiError(422, "unsupported_connection", "该服务暂不支持账户连接。");
    }
    await preparePiRuntime(this.rootDir, {
      runtimeDirectory: "data/pi-agent",
      sessionDirectory: "data/pi-sessions",
      workspaceDirectory: "data/sessions",
    });
    const runtime = await ModelRuntime.create({
      authPath: path.join(this.rootDir, "data", "pi-agent", "auth.json"),
      modelsPath: path.join(this.rootDir, "data", "pi-agent", "models.json"),
    });
    if (!runtime.getProvider(provider)?.auth.oauth) {
      throw new ApiError(422, "subscription_login_unavailable", "当前运行时未提供该账户的订阅登录。");
    }
    const connection: AccountConnection = {
      id: randomUUID(), provider, status: "waiting", message: "正在准备账户授权。", createdAt: Date.now(), controller: new AbortController(),
    };
    this.connections.set(connection.id, connection);
    void runtime.login(provider, "oauth", {
      signal: connection.controller.signal,
      notify: (event) => this.handleNotification(connection, event),
      prompt: (prompt) => this.waitForPrompt(connection, prompt),
    }).then(() => {
      connection.status = "connected";
      connection.message = "账户已连接。";
      delete connection.prompt;
    }).catch(() => {
      if (connection.status === "cancelled") return;
      connection.status = "failed";
      connection.message = "账户连接未完成，请重试或检查账户授权。";
      delete connection.prompt;
    });
    return connection;
  }

  get(id: string): AccountConnection | undefined {
    this.pruneConnections();
    return this.connections.get(id);
  }

  respond(id: string, value: unknown): AccountConnection {
    this.pruneConnections();
    const connection = this.connections.get(id);
    if (!connection) throw new ApiError(404, "connection_not_found", "未找到该账户连接。");
    if (!connection.resolvePrompt || !connection.prompt) throw new ApiError(409, "connection_not_waiting", "当前连接不需要输入。");
    if (typeof value !== "string" || !value.trim()) throw new ApiError(422, "invalid_connection_input", "请输入有效内容。");
    const resolve = connection.resolvePrompt;
    delete connection.resolvePrompt;
    delete connection.prompt;
    resolve(value.trim());
    return connection;
  }

  cancel(id: string): AccountConnection {
    this.pruneConnections();
    const connection = this.connections.get(id);
    if (!connection) throw new ApiError(404, "connection_not_found", "未找到该账户连接。");
    if (connection.status === "waiting") {
      connection.status = "cancelled";
      connection.message = "已取消账户连接。";
      connection.controller.abort();
    }
    return connection;
  }

  private pruneConnections(): void {
    const now = Date.now();
    for (const [id, connection] of this.connections) {
      if (connection.status !== "waiting" && now - connection.createdAt >= AccountConnectionStore.completedRetentionMs) {
        this.connections.delete(id);
      }
    }
    const completed = [...this.connections.entries()]
      .filter(([, connection]) => connection.status !== "waiting")
      .sort(([, left], [, right]) => left.createdAt - right.createdAt);
    const excess = this.connections.size - AccountConnectionStore.maxRetainedConnections;
    for (const [id] of completed.slice(0, Math.max(0, excess))) this.connections.delete(id);
  }

  private handleNotification(connection: AccountConnection, event: { type: string; [key: string]: unknown }): void {
    if (event.type === "auth_url") {
      connection.message = "请在新窗口完成账户授权。";
      connection.authorization = {
        ...(typeof event.url === "string" ? { url: event.url } : {}),
        ...(typeof event.instructions === "string" ? { instructions: event.instructions } : {}),
      };
      return;
    }
    if (event.type === "device_code") {
      connection.message = "请按提示输入设备授权码。";
      connection.authorization = {
        ...(typeof event.userCode === "string" ? { device_code: event.userCode } : {}),
        ...(typeof event.verificationUri === "string" ? { verification_url: event.verificationUri } : {}),
      };
      return;
    }
    connection.message = "账户授权正在进行中。";
  }

  private waitForPrompt(connection: AccountConnection, prompt: { type: string; message: string; placeholder?: string; options?: readonly { id: string; label: string; description?: string }[]; signal?: AbortSignal }): Promise<string> {
    if (prompt.type === "secret") return Promise.reject(new Error("账户连接不接受网页密钥输入。"));
    if (prompt.type !== "text" && prompt.type !== "select" && prompt.type !== "manual_code") return Promise.reject(new Error("不支持的账户连接步骤。"));
    connection.message = prompt.message;
    connection.prompt = {
      type: prompt.type,
      message: prompt.message,
      ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
      ...(prompt.options ? { options: [...prompt.options] } : {}),
    };
    return new Promise((resolve, reject) => {
      connection.resolvePrompt = resolve;
      const abort = () => reject(new Error("账户连接已取消。"));
      connection.controller.signal.addEventListener("abort", abort, { once: true });
      prompt.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function publicConnection(connection: AccountConnection): Omit<AccountConnection, "controller" | "resolvePrompt" | "createdAt"> {
  const { controller: _controller, resolvePrompt: _resolvePrompt, createdAt: _createdAt, ...visible } = connection;
  return visible;
}

async function subscriptionAuthStatus(rootDir: string): Promise<{ openaiCodex: boolean; anthropic: boolean }> {
  try {
    const runtime = await ModelRuntime.create({
      authPath: path.join(rootDir, "data", "pi-agent", "auth.json"),
      modelsPath: path.join(rootDir, "data", "pi-agent", "models.json"),
    });
    const [openaiCodex, anthropic] = await Promise.all([runtime.checkAuth("openai-codex"), runtime.checkAuth("anthropic")]);
    return { openaiCodex: openaiCodex?.type === "oauth", anthropic: anthropic?.type === "oauth" };
  } catch {
    return { openaiCodex: false, anthropic: false };
  }
}

export function createPiRpcExecutor(input: {
  rootDir: string;
  clientFactory?: (options: PiRpcClientOptions) => PiRpcClientLike;
  streamStallTimeoutMs?: number;
}): PiRpcExecutor {
  const rootDir = path.resolve(input.rootDir);
  const pool = new PiRpcSessionPool<PiRpcClientLike>();
  const factory = input.clientFactory ?? createDefaultPiRpcClient;
  const configuredStreamStallTimeoutMs = input.streamStallTimeoutMs ?? Number(process.env.EBM_STREAM_STALL_TIMEOUT_MS);
  const streamStallTimeoutMs = Number.isFinite(configuredStreamStallTimeoutMs) && configuredStreamStallTimeoutMs > 0
    ? configuredStreamStallTimeoutMs
    : DEFAULT_STREAM_STALL_TIMEOUT_MS;

  const execute = async (request: AgentRunInput, hooks: AgentExecutionHooks): Promise<AgentExecutionResult> => {
    if (hooks.signal.aborted) throw abortError();
    const runtimeKey = [request.provider, request.model, request.retrievalPolicy, request.maxIterations].join("\0");
    return pool.run({
      ...(request.sessionId ? { requestedSessionId: request.sessionId } : {}),
      runtimeKey,
      createClient: async () => {
        const args = [
          "--approve",
          "--session-dir", path.join(rootDir, "data", "pi-sessions"),
          "--no-extensions",
          "--extension", path.join(rootDir, ".pi", "extensions", "ebm-providers.ts"),
          "--extension", path.join(rootDir, ".pi", "extensions", "ebm-tools.ts"),
          "--no-skills",
          "--skill", path.join(rootDir, ".pi", "skills", "ebm-research", "SKILL.md"),
          "--skill", path.join(rootDir, ".pi", "skills", "clinical-report-writing", "SKILL.md"),
        ];
        if (request.sessionId) args.push("--session", request.sessionId);
        else args.push("--name", sessionWorkspaceLabel(request.question));
        return factory(await buildPiRpcClientOptions(rootDir, {
          runtimeDirectory: "data/pi-agent",
          sessionDirectory: "data/pi-sessions",
          workspaceDirectory: "data/sessions",
          provider: request.provider,
          model: request.model,
          args,
          extraEnv: {
            PI_SKIP_VERSION_CHECK: "1",
            PI_CODING_AGENT_DIR: path.join(rootDir, "data", "pi-agent"),
            EBM_RETRIEVAL_POLICY: request.retrievalPolicy,
            EBM_MAX_ITERATIONS: String(request.maxIterations),
            EBM_STREAM_STALL_TIMEOUT_MS: "0",
          },
        }));
      },
      execute: (client, sessionId) => runPiRpc({ rootDir, request, hooks, client, sessionId, streamStallTimeoutMs }),
    });
  };

  const executor = execute as PiRpcExecutor;
  executor.dispose = () => pool.dispose();
  return executor;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, store: AgentRunStore, corsOrigin: string, runtimeConfig: () => Promise<RuntimeConfig>, accountConnections?: AccountConnectionStore, patientIntakeExecutor?: PatientIntakeExecutor, patientWorkspace = new PatientWorkspace(process.cwd()), staticDir?: string, rootDir = process.cwd(), auth = new InternalAuthStore(), ownership = new SessionOwnershipStore(rootDir)): Promise<void> {
  setCors(response, corsOrigin);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  const requestPathname = url.pathname.replace(/\/$/, "") || "/";
  const pathname = requestPathname === "/ts-api" ? "/" : requestPathname.startsWith("/ts-api/") ? requestPathname.slice(7) : requestPathname;
  try {
  if (request.method === "GET" && pathname === "/api/v1/auth/config") {
    sendJson(response, 200, { auth_required: auth.enabled });
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/login") {
    const body = await readJsonBody(request);
    const clientKey = request.socket.remoteAddress ?? "unknown";
    const login = isRecord(body) ? auth.login(body.username, body.access_key, clientKey) : undefined;
    if (auth.enabled && !login) {
      sendJson(response, 401, { ok: false, contract_version: CONTRACT_VERSION, error: { code: "invalid_credentials", message: "用户名或内部访问密钥不正确。 " } });
      return;
    }
    if (!auth.enabled) {
      sendJson(response, 200, { auth_required: false });
      return;
    }
    response.setHeader("Set-Cookie", auth.cookie(login!.token, request.headers["x-forwarded-proto"] === "https"));
    sendJson(response, 200, { auth_required: true, user: login!.user });
    return;
  }
  const authUser = auth.authenticate(request);
  const requiresAuth = auth.enabled && pathname.startsWith("/api/");
  if (requiresAuth && !authUser) {
    sendJson(response, 401, { ok: false, contract_version: CONTRACT_VERSION, error: { code: "authentication_required", message: "请先登录内部测试服务。 " } });
    return;
  }
  if (request.method === "POST" && pathname === "/api/v1/auth/logout") {
    auth.logout(request);
    response.setHeader("Set-Cookie", auth.clearCookie(request.headers["x-forwarded-proto"] === "https"));
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && pathname === "/api/v1/auth/me") {
    sendJson(response, 200, { user: authUser });
    return;
  }
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "xunyi-research-service",
        contract_version: CONTRACT_VERSION,
        endpoints: ["GET /api/v1/runtime-config", "POST /api/v1/agent-runs", "GET /api/v1/agent-runs/{run_id}", "POST /api/v1/agent-runs/{run_id}/cancel", "POST /api/v1/patient-intake/messages", "POST /api/v1/patient-intake/summary", "GET /api/v1/research-sessions/{session_id}/files", "GET /api/v1/research-sessions/{session_id}/citations"],
      });
      return;
    }
    if (request.method === "GET" && pathname === "/api/v1/runtime-config") {
      sendJson(response, 200, await runtimeConfig());
      return;
    }
    if (request.method === "POST" && (pathname === "/api/v1/patient-intake/messages" || pathname === "/api/v1/patient-intake/summary")) {
      if (!patientIntakeExecutor) throw new ApiError(503, "patient_intake_unavailable", "就诊准备服务暂未启用。");
      const input = validatePatientIntakeInput(await readJsonBody(request), await runtimeConfig());
      const intent = pathname.endsWith("/summary") ? "summary" : "conversation";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const result = await patientWorkspace.execute(input, intent, patientIntakeExecutor, controller.signal);
        sendJson(response, 200, {
          contract_version: PATIENT_CONTRACT_VERSION, session_id: input.clientSessionId, reply: result.reply,
          ...(result.reportPath ? { report_path: result.reportPath } : {}),
        });
      } finally {
        clearTimeout(timeout);
      }
      return;
    }
    const workspaceMatch = /^\/api\/v1\/research-sessions\/([^/]+)\/files$/.exec(pathname);
    if (workspaceMatch && request.method === "GET") {
      const sessionId = decodePathSegment(workspaceMatch[1] ?? "");
      if (authUser) await ownership.assertOwner(sessionId, authUser.id);
      const requestedPath = url.searchParams.get("path");
      if (requestedPath) {
        sendJson(response, 200, await readWorkspaceFile(rootDir, sessionId, requestedPath));
      } else {
        const workspace = await sessionWorkspace(rootDir, sessionId);
        sendJson(response, 200, { session_id: sessionId, files: await listWorkspaceFiles(workspace) });
      }
      return;
    }
    const citationMatch = /^\/api\/v1\/research-sessions\/([^/]+)\/citations$/.exec(pathname);
    if (citationMatch && request.method === "GET") {
      const sessionId = decodePathSegment(citationMatch[1] ?? "");
      if (authUser) await ownership.assertOwner(sessionId, authUser.id);
      const reportPath = url.searchParams.get("report_path") ?? "";
      const number = Number(url.searchParams.get("number"));
      if (!Number.isInteger(number) || number < 1) throw new ApiError(422, "invalid_citation_number", "引用编号必须是正整数。 ");
      sendJson(response, 200, await readCitationDetail(rootDir, sessionId, reportPath, number));
      return;
    }
    if (accountConnections && request.method === "POST" && pathname === "/api/v1/account-connections") {
      const body = await readJsonBody(request);
      const provider = isRecord(body) ? body.provider : undefined;
      sendJson(response, 202, publicConnection(await accountConnections.start(typeof provider === "string" ? provider : "")));
      return;
    }
    const connectionMatch = /^\/api\/v1\/account-connections\/([^/]+)(?:\/(input|cancel))?$/.exec(pathname);
    if (accountConnections && connectionMatch) {
      const id = decodePathSegment(connectionMatch[1] ?? "");
      if (request.method === "GET" && !connectionMatch[2]) {
        const connection = accountConnections.get(id);
        if (!connection) throw new ApiError(404, "connection_not_found", "未找到该账户连接。");
        sendJson(response, 200, publicConnection(connection));
        return;
      }
      if (request.method === "POST" && connectionMatch[2] === "input") {
        const body = await readJsonBody(request);
        sendJson(response, 200, publicConnection(accountConnections.respond(id, isRecord(body) ? body.value : undefined)));
        return;
      }
      if (request.method === "POST" && connectionMatch[2] === "cancel") {
        sendJson(response, 200, publicConnection(accountConnections.cancel(id)));
        return;
      }
    }
    if (request.method === "POST" && pathname === "/api/v1/agent-runs") {
      const input = validateAgentRunInput(await readJsonBody(request), await runtimeConfig());
      if (authUser && input.sessionId) await ownership.assertOwner(input.sessionId, authUser.id);
      const run = store.submit(input, authUser?.id);
      sendJson(response, 202, {
        ...run,
        poll_url: `/api/v1/agent-runs/${run.run_id}`,
        cancel_url: `/api/v1/agent-runs/${run.run_id}/cancel`,
      });
      return;
    }
    const match = /^\/api\/v1\/agent-runs\/([^/]+)(?:\/(cancel))?$/.exec(pathname);
    if (match) {
      const runId = decodePathSegment(match[1] ?? "");
      if (request.method === "GET" && !match[2]) {
        const run = store.get(runId, authUser?.id);
        if (!run) throw new ApiError(404, "run_not_found", "未找到该 Agent 任务。");
        sendJson(response, 200, run);
        return;
      }
      if (request.method === "POST" && match[2] === "cancel") {
        const run = store.cancel(runId, authUser?.id);
        if (!run) throw new ApiError(404, "run_not_found", "未找到该 Agent 任务。");
        sendJson(response, 202, run);
        return;
      }
    }
    if (
      request.method === "GET"
      && staticDir
      && !requestPathname.startsWith("/api/")
      && !requestPathname.startsWith("/ts-api/")
      && await serveStatic(response, staticDir, requestPathname)
    ) return;
    throw new ApiError(404, "not_found", "未找到接口。");
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : error instanceof PatientIntakeError
        ? new ApiError(error.status, error.code, error.message)
        : error instanceof WorkspaceServiceError
          ? new ApiError(error.status, error.code, error.message)
        : error instanceof SessionOwnershipError
          ? new ApiError(404, error.code, error.message)
        : new ApiError(500, "internal_error", errorMessage(error));
    const responseContract = pathname.startsWith("/api/v1/patient-intake/") ? PATIENT_CONTRACT_VERSION : CONTRACT_VERSION;
    sendJson(response, apiError.status, { ok: false, contract_version: responseContract, error: { code: apiError.code, message: apiError.message } });
  }
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) throw new ApiError(400, "invalid_path_encoding", "路径参数编码无效。");
    throw error;
  }
}

async function serveStatic(response: ServerResponse, staticDir: string, pathname: string): Promise<boolean> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(staticDir, requested);
  const insideStaticDir = target === staticDir || target.startsWith(`${staticDir}${path.sep}`);
  if (!insideStaticDir) return false;
  let staticRoot: string;
  try {
    staticRoot = await realpath(staticDir);
  } catch {
    return false;
  }
  const file = await safeStaticFile(staticRoot, target)
    ?? (path.extname(requested) ? undefined : await safeStaticFile(staticRoot, path.join(staticDir, "index.html")));
  if (!file) return false;
  const extension = path.extname(file);
  const contentType = ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=31536000, immutable",
  });
  response.end(await readFile(file));
  return true;
}

async function safeStaticFile(staticRoot: string, candidate: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(candidate);
    const relative = path.relative(staticRoot, resolved);
    if (relative && (relative.startsWith("..") || path.isAbsolute(relative))) return undefined;
    return (await stat(resolved)).isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function validateAgentRunInput(value: unknown, runtimeConfig: RuntimeConfig): AgentRunInput {
  if (!isRecord(value)) throw new ApiError(400, "invalid_json", "请求体必须是 JSON 对象。");
  const question = requiredString(value.question, "question", 12_000);
  const attachments = value.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    throw new ApiError(422, "attachments_not_supported", "TypeScript 适配层首版尚未接入文件上传；请先移除附件，或继续使用旧 Python 后端处理附件。");
  }
  const audienceMode = enumValue(value.audience_mode, ["clinician", "public"] as const, "audience_mode", "clinician");
  const thinkingLevel = enumValue(value.thinking_level, ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const, "thinking_level", "high");
  const maxIterations = 32;
  const requestTimeoutSeconds = 600;
  // This endpoint runs the clinician research workflow. Keep audience_mode in
  // the wire contract for compatibility, but do not mistake it for the future
  // patient intake workflow: that flow will have its own no-tool endpoint.
  const retrievalPolicy = enumValue(value.retrieval_policy, ["all", "mcp_only"] as const, "retrieval_policy", "all");
  const sessionId = optionalString(value.session_id, "session_id", 200);
  const provider = optionalString(value.provider, "provider", 80) ?? runtimeConfig.default_provider;
  const model = optionalString(value.model, "model", 160) ?? runtimeConfig.models.find((item) => item.provider === provider)?.model ?? runtimeConfig.default_model;
  const selected = runtimeConfig.models.find((item) => item.provider === provider && item.model === model);
  if (!selected) throw new ApiError(422, "unsupported_model", "该模型不在当前循医运行配置中。");
  if (!selected.available) throw new ApiError(422, "model_not_configured", `${selected.provider_label} 尚未在服务器配置中启用。`);
  return {
    question,
    ...(sessionId ? { sessionId } : {}),
    audienceMode,
    thinkingLevel,
    // Clinician research always keeps the evidence toolchain available. The
    // former "current-session-only" mode caused the agent to fall back to
    // ad-hoc filesystem inspection when it needed more evidence.
    searchEnabled: true,
    retrievalPolicy,
    maxIterations,
    requestTimeoutSeconds,
    provider,
    model,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new ApiError(413, "request_too_large", "请求体超过 1 MB 限制。");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) throw new ApiError(400, "empty_request", "请求体不能为空。");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "请求体不是有效 JSON。");
  }
}

async function runPiRpc(input: { rootDir: string; request: AgentRunInput; hooks: AgentExecutionHooks; client: PiRpcClientLike; sessionId: string; streamStallTimeoutMs: number }): Promise<AgentExecutionResult> {
  const { rootDir, request, hooks, client, sessionId, streamStallTimeoutMs } = input;
  let latestAnswer = "";
  const tools: Array<Record<string, unknown>> = [];
  const traceEvents: AgentTraceEvent[] = [];
  const preparationToolCalls = new Set<string>();

  const addTrace = (event: AgentTraceEvent) => {
    traceEvents.push(event);
    if (traceEvents.length > MAX_TRACE_EVENTS) traceEvents.splice(0, traceEvents.length - MAX_TRACE_EVENTS);
    hooks.onTrace(event);
  };
  const addTool = (event: Record<string, unknown>) => {
    const id = typeof event.id === "string" ? event.id : undefined;
    const existing = id ? tools.findIndex((item) => item.id === id) : -1;
    if (existing >= 0) tools[existing] = { ...tools[existing], ...event };
    else tools.push(event);
    if (tools.length > MAX_TOOL_EVENTS) tools.splice(0, tools.length - MAX_TOOL_EVENTS);
    hooks.onTool(event);
  };
  let activeToolExecutions = 0;
  let streamStallTimer: ReturnType<typeof setTimeout> | undefined;
  let terminalError: Error | undefined;
  let rejectTermination: (error: Error) => void = () => undefined;
  const termination = new Promise<never>((_resolve, reject) => { rejectTermination = reject; });
  const clearStreamStallTimer = () => {
    if (streamStallTimer) clearTimeout(streamStallTimer);
    streamStallTimer = undefined;
  };
  const terminate = (error: Error) => {
    if (terminalError) return;
    terminalError = error;
    clearStreamStallTimer();
    void client.abort().catch(() => undefined);
    rejectTermination(error);
  };
  const armStreamStallTimer = () => {
    clearStreamStallTimer();
    if (activeToolExecutions > 0 || terminalError) return;
    streamStallTimer = setTimeout(() => {
      addTrace(trace("runtime.stream_stalled", "模型流长时间无响应", `连续 ${Math.round(streamStallTimeoutMs / 1000)} 秒未收到模型活动，已中止本轮请求。`));
      terminate(new Error(`Model stream stalled for ${streamStallTimeoutMs}ms`));
    }, streamStallTimeoutMs);
  };
  const observeRuntimeActivity = (event: Record<string, unknown>) => {
    if (event.type === "tool_execution_start") {
      activeToolExecutions += 1;
      clearStreamStallTimer();
      return;
    }
    if (event.type === "tool_execution_end") {
      activeToolExecutions = Math.max(0, activeToolExecutions - 1);
      armStreamStallTimer();
      return;
    }
    if (event.type === "agent_end" || event.type === "agent_settled") {
      clearStreamStallTimer();
      return;
    }
    if (event.type === "agent_start" || event.type === "message_start" || event.type === "message_update" || event.type === "message_end" || event.type === "turn_start" || event.type === "turn_end") {
      armStreamStallTimer();
    }
  };
  const consume = (event: unknown) => {
    if (!isRecord(event)) return;
    observeRuntimeActivity(event);
    if (event.type === "tool_execution_start") {
      const name = typeof event.toolName === "string" ? event.toolName : "tool";
      const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const argumentsValue = event.args;
      const preparation = isPreparationRead(rootDir, name, argumentsValue);
      if (preparation && id) preparationToolCalls.add(id);
      addTool({
        ...(id ? { id } : {}), name, status: "running", started_at: new Date().toISOString(),
        ...(preparation ? { presentation: "preparation" } : argumentsValue === undefined ? {} : { arguments: argumentsValue }),
      });
      addTrace(trace("tool.started", preparation ? "准备研究规则" : `调用工具：${name}`, preparation ? "" : toolArgumentsSummary(argumentsValue)));
      return;
    }
    if (event.type === "tool_execution_end") {
      const name = typeof event.toolName === "string" ? event.toolName : "tool";
      const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const preparation = Boolean(id && preparationToolCalls.delete(id));
      const result = preparation ? "已加载研究规则。" : summarizeToolResult(event.result);
      addTool({
        ...(id ? { id } : {}), name, status: event.isError === true ? "error" : "completed", completed_at: new Date().toISOString(),
        ...(preparation ? { presentation: "preparation" } : {}),
        ...(result ? { result } : {}),
      });
      addTrace(trace(event.isError === true ? "tool.failed" : "tool.completed", preparation ? "研究规则已准备" : `${event.isError === true ? "工具失败" : "工具完成"}：${name}`, result));
      return;
    }
    if (event.type === "message_update" && isRecord(event.assistantMessageEvent) && event.assistantMessageEvent.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
      latestAnswer += event.assistantMessageEvent.delta;
      return;
    }
    if (event.type === "message_end" && isRecord(event.message) && event.message.role === "assistant") {
      const text = contentText(event.message.content);
      if (text) {
        latestAnswer = text;
        if (event.message.stopReason === "toolUse") {
          hooks.onProgress({ text, timestamp: new Date().toISOString() });
        }
      }
      else if (typeof event.message.errorMessage === "string") addTrace(trace("model.error", "模型服务请求失败", modelErrorSummary(event.message.errorMessage)));
      return;
    }
    if (event.type === "agent_start") addTrace(trace("agent.started", "研究引擎已启动", ""));
    if (event.type === "agent_end") {
      const messages = Array.isArray(event.messages) ? event.messages : [];
      const finalAssistant = [...messages].reverse().find((message) => isRecord(message) && message.role === "assistant");
      if (isRecord(finalAssistant)) {
        const text = contentText(finalAssistant.content);
        if (text) latestAnswer = text;
      }
    }
  };

  hooks.setSessionId(sessionId);
  addTrace(trace("runtime.session", request.sessionId ? "研究会话已恢复" : "研究会话已创建", sessionId));
  await initializePiSessionDirectory(rootDir, sessionId, {
    sessionName: sessionWorkspaceLabel(request.question),
    firstPrompt: request.question,
  });
  try {
    await initResearchFrame({ sessionDir: piSessionDirectory(rootDir, sessionId), userQuestion: request.question });
    addTrace(trace("research_frame.ready", "研究框架已就绪", "可在本题文档中查看并随研究进展更新。"));
  } catch (error) {
    addTrace(trace("research_frame.error", "研究框架暂不可用", errorMessage(error)));
  }

  await client.setThinkingLevel(request.thinkingLevel);
  const state = await client.getState();
  if (state.thinkingLevel !== request.thinkingLevel) {
    addTrace(trace("runtime.thinking", "推理强度已由运行时调整", `${request.thinkingLevel} → ${state.thinkingLevel}`));
  }
  const unsubscribe = client.onEvent(consume);
  const timeout = setTimeout(() => {
    addTrace(trace("runtime.request_timed_out", "研究请求达到总时限", `总运行时间超过 ${request.requestTimeoutSeconds} 秒，已中止本轮请求。`));
    terminate(new Error(`Agent request timed out after ${request.requestTimeoutSeconds}s`));
  }, request.requestTimeoutSeconds * 1000);
  const abort = () => terminate(abortError());
  hooks.signal.addEventListener("abort", abort, { once: true });
  try {
    const reportsBefore = new Map((await readFinalReportRevisions(rootDir, sessionId)).map((report) => [report.path, report.revision]));
    armStreamStallTimer();
    const operation = (async () => {
      const settled = client.waitForIdle((request.requestTimeoutSeconds + 5) * 1000);
      await client.prompt(buildAgentPrompt(request));
      await settled;
    })();
    await Promise.race([operation, termination]);
    if (hooks.signal.aborted) throw abortError();
    const message = ((await client.getLastAssistantText()) || latestAnswer).trim();
    if (!message) {
      const modelError = traceEvents.findLast((event) => event.kind === "model.error")?.detail;
      throw new Error(modelError || "研究引擎完成后未返回可展示的回答。");
    }
    const report = (await readFinalReportRevisions(rootDir, sessionId))
      .filter((candidate) => reportsBefore.get(candidate.path) !== candidate.revision)
      .sort((left, right) => right.modified - left.modified)[0];
    if (!report) throw new Error("研究引擎已返回回答，但本轮正式报告未生成或未更新。");
    return {
      sessionId,
      message,
      reportMarkdown: report.markdown,
      reportPath: report.path,
    };
  } finally {
    clearTimeout(timeout);
    clearStreamStallTimer();
    hooks.signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}

function sessionWorkspaceLabel(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  return Array.from(compact).slice(0, 64).join("") || "临床研究";
}

function defaultRuntimeConfig(): RuntimeConfig {
  return {
    default_provider: "deepseek",
    default_model: "deepseek-v4-flash",
    models: [
      { provider: "deepseek", provider_label: "DeepSeek", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: true },
    ],
  };
}

function toolArgumentsSummary(value: unknown): string {
  const text = summarizeToolResult(value);
  return text ? `输入：${text}` : "";
}

function isPreparationRead(rootDir: string, name: string, argumentsValue: unknown): boolean {
  if (name !== "read" || !isRecord(argumentsValue) || typeof argumentsValue.path !== "string") return false;
  const instructionRoot = path.join(rootDir, ".pi");
  return path.resolve(argumentsValue.path).startsWith(`${instructionRoot}${path.sep}`);
}

function summarizeToolResult(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/((?:api[_-]?key|authorization|bearer))\s*[:=]\s*[^\s,}"']+/gi, "$1: [已隐藏]").slice(0, 12_000);
}

function modelErrorSummary(value: string): string {
  const status = /\b(401|402|403|429|5\d\d)\b/.exec(value)?.[1];
  const message = /"message"\s*:\s*"([^"]+)"/.exec(value)?.[1] ?? value;
  return `${status ? `模型服务返回 ${status}：` : "模型服务错误："}${message}`.slice(0, 500);
}

export function buildAgentPrompt(input: AgentRunInput): string {
  const audienceInstruction = "使用面向临床人员的中文；按临床决策需要呈现证据等级、效应量和适用边界。";
  const retrievalInstruction = input.retrievalPolicy === "mcp_only"
    ? "本轮外部临床知识检索仅使用指南库：使用 guideline_mcp_search、guideline_mcp_retrieve、guideline_mcp_read，不使用 PubMed、公共网页或本地来源库检索。Pi 的 read、bash 等本地工具仍可用于读取和定位本会话已归档内容，但不得借此增加其他外部检索来源。若指南证据不足，明确报告证据缺口。最终面向用户的报告不得出现 MCP、RAG、工具调用、内部文件路径或内部 evidence ID。"
    : "可按需使用已配置的检索工具。检索顺序：每个新的临床子问题先调用 source_library_search；若返回直接相关的历史来源，优先用其 source_url 调用 web_read 复用本地归档，再用 guideline_mcp_search/retrieve/read 补充或核验。只有本地库无直接相关来源、需要最新版本，或需要解决指南冲突时，才转向 MCP/PubMed/web。不要把 guideline_mcp_search 的文档候选当作证据片段；只有读取文档或 retrieve 返回的片段后才能登记证据。不要通过目录扫描寻找证据。";
  return [
    "你是循医的循证研究服务。请输出中文、可追溯且不过度断言的循证回答。所有可见的工具调用前说明、阶段进展和中间计划都必须使用简短中文；thinking_level=off 时不要输出英文计划，直接调用工具。",
    audienceInstruction,
    "医生版正式报告必须遵循 clinical-report-writing skill：以临床总决策拆出最少的、能改变选择的循证子问题；每个分析小节先给出裁决，再解释证据如何支持或限制它，并回到当前病例的适用条件。报告标题与结构由该 skill 和实际临床决策决定，不得按文献逐篇罗列，不得把内部工具、文件路径或检索日志写给医生。",
    "调用 report_write 前自检：每个关键子问题都说明了待裁决主张、直接或间接证据、证据能与不能推出什么、对病例意味着什么；关键医学判断、阈值、疗效或安全性数字紧跟编号引用；正文引用与参考文献编号完全对应。",
    "本轮必须生成正式循证报告：在最终回复前调用 report_write；若 report_write 只保存了 draft，则修复后调用 report_finalize。不得只在聊天消息中输出摘要而跳过正式报告文件。最终聊天消息使用自然、简洁的中文答复，概括结论、重要边界和下一步，不复制完整报告；该摘要会与正式报告同时展示。",
    "研究过程中，可在工具调用前用一句简短中文说明对医生有意义的进展。只有研究目标、临床判断或面向医生的阶段发生实质变化时才说明进展，例如完成问题框定、找到会改变决策的关键证据、发现重要冲突或缺口、停止检索并进入写作。原文定位、登记证据和可自动恢复的工具重试属于内部操作，无需播报；同一阶段不要反复说明‘证据已足够’或下一项内部动作。不要暴露工具参数、内部路径，也不要把未经核验的中间发现写成结论；无需为了展示而凑数量。",
    retrievalInstruction,
    `本轮最大工具迭代预算为 ${input.maxIterations}（提示性约束）。`,
    "临床问题：",
    input.question,
  ].filter(Boolean).join("\n\n");
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : "").join("");
}

function trace(kind: string, label: string, detail: string): AgentTraceEvent {
  return { kind, label, ...(detail ? { detail } : {}), timestamp: new Date().toISOString() };
}

function setCors(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (origin !== "*") response.setHeader("Access-Control-Allow-Credentials", "true");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(422, "invalid_request", `${label} 必须是非空字符串。`);
  const result = value.trim();
  if (result.length > maxLength) throw new ApiError(422, "invalid_request", `${label} 不能超过 ${maxLength} 个字符。`);
  return result;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ApiError(422, "invalid_request", `${label} 必须是字符串。`);
  const result = value.trim();
  if (result.length > maxLength) throw new ApiError(422, "invalid_request", `${label} 不能超过 ${maxLength} 个字符。`);
  return result || undefined;
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], label: string, fallback: T): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) throw new ApiError(422, "invalid_request", `${label} 必须是 ${choices.join(" / ")} 之一。`);
  return value as T;
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new ApiError(422, "invalid_request", `${label} 必须是布尔值。`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return redactDiagnostic(error instanceof Error ? error.message : String(error));
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\b\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|signature)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\bhttps?:\/\/[^\s]*(?:webhook|\/hooks\/)[^\s]*/gi, "[redacted-url]")
    .slice(0, 2_000);
}

function abortError(): Error {
  const error = new Error("Agent run cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
