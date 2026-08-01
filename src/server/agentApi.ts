import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { initResearchFrame } from "../tools/researchFrame.js";
import { piSessionDirectory } from "../extensions/sessionPath.js";
import { PatientIntakeError, type PatientIntakeExecutor, validatePatientIntakeInput } from "./patientIntake.js";

const CONTRACT_VERSION = "xunyi-research/v1";
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_TRACE_EVENTS = 240;
const MAX_TOOL_EVENTS = 160;

export type AgentRunStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
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

export type AgentRunResponse = {
  contract_version: string;
  run_id: string;
  status: AgentRunStatus;
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
};

export class AgentRunStore {
  private readonly runs = new Map<string, InternalRun>();

  constructor(private readonly executor: AgentExecutor, private readonly maxCompletedRuns = 100) {}

  submit(input: AgentRunInput): AgentRunResponse {
    this.pruneCompletedRuns();
    const run: InternalRun = {
      id: randomUUID(),
      input,
      status: "queued",
      createdAt: new Date().toISOString(),
      message: "任务已创建，等待循证研究服务运行。",
      agentTrace: [trace("run.queued", "任务已创建", "等待研究引擎启动")],
      progressUpdates: [],
      tools: [],
      controller: new AbortController(),
    };
    this.runs.set(run.id, run);
    queueMicrotask(() => void this.execute(run));
    return this.toResponse(run);
  }

  get(runId: string): AgentRunResponse | undefined {
    const run = this.runs.get(runId);
    return run ? this.toResponse(run) : undefined;
  }

  cancel(runId: string): AgentRunResponse | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
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
    run.startedAt = new Date().toISOString();
    run.message = "循证研究服务正在检索和生成回答。";
    this.addTrace(run, trace("run.started", "任务已启动", `推理强度：${run.input.thinkingLevel}`));
    try {
      const result = await this.executor(run.input, {
        signal: run.controller.signal,
        setSessionId: (sessionId) => {
          run.sessionId = sessionId;
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
      run.completedAt = new Date().toISOString();
      run.message = result.message.trim() || "Agent 已完成，但没有生成可展示的文本。";
      this.addTrace(run, trace("run.completed", "任务完成", "已收到最终回答"));
    } catch (error) {
      if (run.controller.signal.aborted || isAbortError(error)) {
        this.markCancelled(run);
        return;
      }
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.message = "循证研究服务未能完成本次任务。";
      run.error = { code: "agent_execution_failed", message: errorMessage(error) };
      this.addTrace(run, trace("run.failed", "任务失败", run.error.message));
    }
  }

  private markCancelled(run: InternalRun): void {
    run.status = "cancelled";
    run.completedAt = new Date().toISOString();
    run.message = "任务已中断。";
    this.addTrace(run, trace("run.cancelled", "任务已中断", "研究引擎已收到取消信号"));
  }

  private addTrace(run: InternalRun, event: AgentTraceEvent): void {
    run.agentTrace.push(event);
    if (run.agentTrace.length > MAX_TRACE_EVENTS) run.agentTrace.splice(0, run.agentTrace.length - MAX_TRACE_EVENTS);
  }

  private addTool(run: InternalRun, event: Record<string, unknown>): void {
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
};

export function createAgentApiServer(options: AgentApiServerOptions): { server: Server; store: AgentRunStore } {
  const store = new AgentRunStore(options.executor, options.maxCompletedRuns);
  const configuredRuntimeConfig = options.runtimeConfig;
  const runtimeConfig = typeof configuredRuntimeConfig === "function"
    ? configuredRuntimeConfig
    : async () => configuredRuntimeConfig ?? defaultRuntimeConfig();
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : undefined;
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const server = createServer((request, response) => {
    void handleRequest(request, response, store, options.corsOrigin ?? "*", runtimeConfig, options.accountConnections, options.patientIntakeExecutor, staticDir, rootDir);
  });
  return { server, store };
}

export async function loadRuntimeConfig(rootDir: string): Promise<RuntimeConfig> {
  const env = { ...(await projectEnv(rootDir)), ...process.env };
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
  private readonly connections = new Map<string, AccountConnection>();

  constructor(private readonly rootDir: string) {}

  async start(provider: string): Promise<AccountConnection> {
    if (provider !== "openai-codex" && provider !== "anthropic") {
      throw new ApiError(422, "unsupported_connection", "该服务暂不支持账户连接。");
    }
    await preparePiAgentDirectory(this.rootDir);
    const runtime = await ModelRuntime.create({
      authPath: path.join(this.rootDir, "data", "pi-agent", "auth.json"),
      modelsPath: path.join(this.rootDir, "data", "pi-agent", "models.json"),
    });
    if (!runtime.getProvider(provider)?.auth.oauth) {
      throw new ApiError(422, "subscription_login_unavailable", "当前运行时未提供该账户的订阅登录。");
    }
    const connection: AccountConnection = {
      id: randomUUID(), provider, status: "waiting", message: "正在准备账户授权。", controller: new AbortController(),
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
    return this.connections.get(id);
  }

  respond(id: string, value: unknown): AccountConnection {
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
    const connection = this.connections.get(id);
    if (!connection) throw new ApiError(404, "connection_not_found", "未找到该账户连接。");
    if (connection.status === "waiting") {
      connection.status = "cancelled";
      connection.message = "已取消账户连接。";
      connection.controller.abort();
    }
    return connection;
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

function publicConnection(connection: AccountConnection): Omit<AccountConnection, "controller" | "resolvePrompt"> {
  const { controller: _controller, resolvePrompt: _resolvePrompt, ...visible } = connection;
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

export function createPiCliExecutor(input: { rootDir: string }): AgentExecutor {
  return async (request, hooks) => {
    if (hooks.signal.aborted) throw abortError();
    const rootDir = path.resolve(input.rootDir);
    const piEntrypoint = path.join(rootDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    await access(piEntrypoint);
    await preparePiAgentDirectory(rootDir);
    let timedOut = false;
    const localController = new AbortController();
    const onExternalAbort = () => localController.abort(hooks.signal.reason);
    const timeout = setTimeout(() => {
      timedOut = true;
      localController.abort(new Error(`Agent request timed out after ${request.requestTimeoutSeconds}s`));
    }, request.requestTimeoutSeconds * 1000);
    hooks.signal.addEventListener("abort", onExternalAbort, { once: true });
    try {
      return await runPiCli({ rootDir, piEntrypoint, request, hooks, signal: localController.signal });
    } catch (error) {
      if (timedOut && !hooks.signal.aborted) throw new Error(`Agent request timed out after ${request.requestTimeoutSeconds}s`);
      throw error;
    } finally {
      clearTimeout(timeout);
      hooks.signal.removeEventListener("abort", onExternalAbort);
    }
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, store: AgentRunStore, corsOrigin: string, runtimeConfig: () => Promise<RuntimeConfig>, accountConnections?: AccountConnectionStore, patientIntakeExecutor?: PatientIntakeExecutor, staticDir?: string, rootDir = process.cwd()): Promise<void> {
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
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "xunyi-research-service",
        contract_version: CONTRACT_VERSION,
        endpoints: ["GET /api/v1/runtime-config", "POST /api/v1/agent-runs", "GET /api/v1/agent-runs/{run_id}", "POST /api/v1/agent-runs/{run_id}/cancel", "POST /api/v1/patient-intake/messages", "POST /api/v1/patient-intake/summary", "GET /api/v1/research-sessions/{session_id}/files"],
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
        const result = await patientIntakeExecutor({ ...input, intent }, controller.signal);
        sendJson(response, 200, { contract_version: CONTRACT_VERSION, session_id: result.sessionId, reply: result.reply });
      } finally {
        clearTimeout(timeout);
      }
      return;
    }
    const workspaceMatch = /^\/api\/v1\/research-sessions\/([^/]+)\/files$/.exec(pathname);
    if (workspaceMatch && request.method === "GET") {
      const sessionId = decodeURIComponent(workspaceMatch[1] ?? "");
      const requestedPath = url.searchParams.get("path");
      if (requestedPath) {
        sendJson(response, 200, await readWorkspaceFile(rootDir, sessionId, requestedPath));
      } else {
        const workspace = await sessionWorkspace(rootDir, sessionId);
        sendJson(response, 200, { session_id: sessionId, files: await listWorkspaceFiles(workspace) });
      }
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
      const id = decodeURIComponent(connectionMatch[1] ?? "");
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
      const run = store.submit(input);
      sendJson(response, 202, {
        ...run,
        poll_url: `/api/v1/agent-runs/${run.run_id}`,
        cancel_url: `/api/v1/agent-runs/${run.run_id}/cancel`,
      });
      return;
    }
    const match = /^\/api\/v1\/agent-runs\/([^/]+)(?:\/(cancel))?$/.exec(pathname);
    if (match) {
      const runId = decodeURIComponent(match[1] ?? "");
      if (request.method === "GET" && !match[2]) {
        const run = store.get(runId);
        if (!run) throw new ApiError(404, "run_not_found", "未找到该 Agent 任务。");
        sendJson(response, 200, run);
        return;
      }
      if (request.method === "POST" && match[2] === "cancel") {
        const run = store.cancel(runId);
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
        : new ApiError(500, "internal_error", errorMessage(error));
    sendJson(response, apiError.status, { ok: false, contract_version: CONTRACT_VERSION, error: { code: apiError.code, message: apiError.message } });
  }
}

async function serveStatic(response: ServerResponse, staticDir: string, pathname: string): Promise<boolean> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(staticDir, requested);
  const insideStaticDir = target === staticDir || target.startsWith(`${staticDir}${path.sep}`);
  if (!insideStaticDir) return false;
  const file = await readableFile(target) ? target : path.extname(requested) ? undefined : path.join(staticDir, "index.html");
  if (!file || !await readableFile(file)) return false;
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

async function readableFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
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
    searchEnabled: optionalBoolean(value.search_enabled, "search_enabled", true),
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

async function preparePiAgentDirectory(rootDir: string): Promise<void> {
  const agentDir = path.join(rootDir, "data", "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await copyFile(path.join(rootDir, ".pi", "models.json"), path.join(agentDir, "models.json"));
  await mkdir(path.join(rootDir, "data", "pi-sessions"), { recursive: true });
  await mkdir(path.join(rootDir, "data", "sessions"), { recursive: true });
}

type WorkspaceFile = {
  path: string;
  kind: "report" | "research_frame" | "evidence" | "source";
  size: number;
  modified_at: string;
};

function safeSessionId(sessionId: string): string {
  if (!sessionId || path.basename(sessionId) !== sessionId) throw new ApiError(422, "invalid_session_id", "无效的研究会话标识。 ");
  return sessionId;
}

async function sessionWorkspace(rootDir: string, sessionId: string): Promise<string> {
  const safeId = safeSessionId(sessionId);
  const sessionsRoot = path.join(rootDir, "data", "sessions");
  let mapping: { directory?: unknown };
  try {
    mapping = JSON.parse(await readFile(path.join(sessionsRoot, ".metadata", "workspaces", `${safeId}.json`), "utf8")) as { directory?: unknown };
  } catch {
    throw new ApiError(404, "workspace_not_found", "未找到该研究会话的工作区。 ");
  }
  if (typeof mapping.directory !== "string" || !mapping.directory || path.basename(mapping.directory) !== mapping.directory) {
    throw new ApiError(404, "workspace_not_found", "未找到该研究会话的工作区。 ");
  }
  return path.join(sessionsRoot, mapping.directory);
}

function workspaceFileKind(relativePath: string): WorkspaceFile["kind"] {
  if (relativePath === "notes/research_frame.md") return "research_frame";
  if (relativePath.startsWith("reports/")) return "report";
  if (relativePath.startsWith("evidence/")) return "evidence";
  return "source";
}

function visibleWorkspacePath(relativePath: string): boolean {
  return relativePath === "notes/research_frame.md"
    || relativePath === "evidence/EVIDENCE.md"
    || /^reports\/(?!drafts\/).+\.md$/.test(relativePath)
    || /^evidence\/ev_[a-f0-9]{16}\.md$/.test(relativePath)
    || /^sources\/(?:read|search)\/.+\/(?:full|toc)\.md$/.test(relativePath);
}

async function listWorkspaceFiles(workspace: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  const walk = async (relative = ""): Promise<void> => {
    const directory = path.join(workspace, relative);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && visibleWorkspacePath(child)) {
        const details = await stat(path.join(workspace, child));
        files.push({ path: child, kind: workspaceFileKind(child), size: details.size, modified_at: details.mtime.toISOString() });
      }
    }
  };
  await Promise.all(["notes", "reports", "evidence", "sources"].map((directory) => walk(directory)));
  return files.sort((left, right) => right.modified_at.localeCompare(left.modified_at));
}

async function readWorkspaceFile(rootDir: string, sessionId: string, relativePath: string): Promise<WorkspaceFile & { session_id: string; content: string }> {
  if (!visibleWorkspacePath(relativePath)) throw new ApiError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  const workspace = await sessionWorkspace(rootDir, sessionId);
  const absolutePath = path.resolve(workspace, relativePath);
  if (!absolutePath.startsWith(`${workspace}${path.sep}`)) throw new ApiError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  let details;
  try {
    details = await stat(absolutePath);
  } catch {
    throw new ApiError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  }
  if (!details.isFile()) throw new ApiError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  return { session_id: sessionId, path: relativePath, kind: workspaceFileKind(relativePath), size: details.size, modified_at: details.mtime.toISOString(), content: await readFile(absolutePath, "utf8") };
}

async function readLatestFinalReport(rootDir: string, sessionId: string): Promise<{ path: string; markdown: string } | undefined> {
  try {
    const workspace = await sessionWorkspace(rootDir, sessionId);
    const reportsDir = path.join(workspace, "reports");
    const entries = (await readdir(reportsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
    const candidates = await Promise.all(entries.map(async (entry) => {
      const file = path.join(reportsDir, entry.name);
      return { file, modified: (await stat(file)).mtimeMs };
    }));
    const latest = candidates.sort((left, right) => right.modified - left.modified)[0];
    return latest ? { path: path.posix.join("reports", path.basename(latest.file)), markdown: (await readFile(latest.file, "utf8")).trim() } : undefined;
  } catch {
    return undefined;
  }
}

async function runPiCli(input: { rootDir: string; piEntrypoint: string; request: AgentRunInput; hooks: AgentExecutionHooks; signal: AbortSignal }): Promise<AgentExecutionResult> {
  const { rootDir, piEntrypoint, request, hooks, signal } = input;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(await projectEnv(rootDir)),
    PI_SKIP_VERSION_CHECK: "1",
    PI_CODING_AGENT_DIR: path.join(rootDir, "data", "pi-agent"),
    EBM_RETRIEVAL_POLICY: request.retrievalPolicy,
    EBM_MAX_ITERATIONS: String(request.maxIterations),
  };
  const args = [
    piEntrypoint,
    "--mode", "json",
    "--approve",
    "--model", `${request.provider}/${request.model}`,
    "--thinking", request.thinkingLevel,
    "--session-dir", path.join(rootDir, "data", "pi-sessions"),
    "--no-extensions",
    "--extension", path.join(rootDir, ".pi", "extensions", "ebm-providers.ts"),
    "--extension", path.join(rootDir, ".pi", "extensions", "ebm-tools.ts"),
    "--no-skills",
    "--skill", path.join(rootDir, ".pi", "skills", "ebm-research", "SKILL.md"),
    "--skill", path.join(rootDir, ".pi", "skills", "clinical-report-writing", "SKILL.md"),
  ];
  if (request.retrievalPolicy === "mcp_only") args.push("--exclude-tools", "bash");
  if (request.sessionId) args.push("--session", request.sessionId);
  else args.push("--name", sessionWorkspaceLabel(request.question));
  args.push(buildAgentPrompt(request));

  const child = spawn(process.execPath, args, { cwd: rootDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdoutBuffer = "";
  let stderr = "";
  let sessionId: string | undefined;
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
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      addTrace(trace("runtime.output", "运行输出无法解析", line.slice(0, 500)));
      return;
    }
    if (!isRecord(event)) return;
    if (event.type === "session" && typeof event.id === "string") {
      sessionId = event.id;
      hooks.setSessionId(sessionId);
      addTrace(trace("runtime.session", "研究会话已创建", sessionId));
      void initResearchFrame({
        sessionDir: piSessionDirectory(rootDir, sessionId),
        userQuestion: request.question,
      }).then(() => {
        addTrace(trace("research_frame.ready", "研究框架已就绪", "可在本题文档中查看并随研究进展更新。"));
      }).catch((error) => {
        addTrace(trace("research_frame.error", "研究框架暂不可用", errorMessage(error)));
      });
      return;
    }
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

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });

  const forcedKill = { value: undefined as NodeJS.Timeout | undefined };
  const abort = () => {
    child.kill("SIGTERM");
    forcedKill.value = setTimeout(() => child.kill("SIGKILL"), 5_000);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    if (stdoutBuffer.trim()) consume(stdoutBuffer);
    if (signal.aborted) throw abortError();
    if (exitCode !== 0) throw new Error(`研究引擎异常退出（代码 ${exitCode}）。`);
    const message = latestAnswer.trim();
    if (!message) {
      const modelError = traceEvents.findLast((event) => event.kind === "model.error")?.detail;
      throw new Error(modelError || "研究引擎完成后未返回可展示的回答。");
    }
    const report = sessionId ? await readLatestFinalReport(rootDir, sessionId) : undefined;
    return {
      ...(sessionId ? { sessionId } : {}),
      message,
      ...(report ? { reportMarkdown: report.markdown, reportPath: report.path } : {}),
      ...(stderr ? { stderr } : {}),
    };
  } finally {
    signal.removeEventListener("abort", abort);
    if (forcedKill.value) clearTimeout(forcedKill.value);
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

async function projectEnv(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path.join(rootDir, ".env"), "utf8");
    const values: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1] ?? "";
      const rawValue = match[2] ?? "";
      values[key] = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    }
    return values;
  } catch {
    return {};
  }
}

export function buildAgentPrompt(input: AgentRunInput): string {
  const audienceInstruction = "使用面向临床人员的中文；按临床决策需要呈现证据等级、效应量和适用边界。";
  const retrievalInstruction = input.retrievalPolicy === "mcp_only"
    ? "本轮仅使用指南库：只使用 guideline_mcp_search、guideline_mcp_retrieve、guideline_mcp_read 及证据/报告工具；禁止 PubMed、公共网页和本地来源库检索。若指南证据不足，明确报告证据缺口，不得改用其他检索来源。最终面向用户的报告不得出现 MCP、RAG、工具调用、内部文件路径或内部 evidence ID。"
    : input.searchEnabled
      ? "可按需使用已配置的检索工具。"
      : "用户要求不进行外部检索；只使用当前会话中的既有材料。";
  return [
    "你是循医的循证研究服务。请输出中文、可追溯且不过度断言的循证回答。",
    audienceInstruction,
    "医生版正式报告必须遵循 clinical-report-writing skill：以临床总决策拆出最少的、能改变选择的循证子问题；每个分析小节先给出裁决，再解释证据如何支持或限制它，并回到当前病例的适用条件。报告标题与结构由该 skill 和实际临床决策决定，不得按文献逐篇罗列，不得把内部工具、文件路径或检索日志写给医生。",
    "调用 report_write 前自检：每个关键子问题都说明了待裁决主张、直接或间接证据、证据能与不能推出什么、对病例意味着什么；关键医学判断、阈值、疗效或安全性数字紧跟编号引用；正文引用与参考文献编号完全对应。",
    "本轮必须生成正式循证报告：在最终回复前调用 report_write；若 report_write 只保存了 draft，则修复后调用 report_finalize。不得只在聊天消息中输出摘要而跳过正式报告文件。最终聊天消息使用自然、简洁的中文答复，概括结论、重要边界和下一步，不复制完整报告；该摘要会与正式报告同时展示。",
    "研究过程中，如下一步值得向医生说明，可在工具调用前用一句简短中文说明正在核对的临床事项。不要暴露工具参数、内部路径，也不要把未经核验的中间发现写成结论；无需为了展示而凑数量，也不要重复已经说明的进展。",
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
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  const error = new Error("Agent run cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
