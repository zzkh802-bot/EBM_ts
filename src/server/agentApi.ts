import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

const CONTRACT_VERSION = "dp-xunyi-agent/v2";
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_TRACE_EVENTS = 240;
const MAX_TOOL_EVENTS = 160;

export type AgentRunStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
export type ResearchMode = "instant" | "expert" | "literature";
export type AudienceMode = "clinician" | "public";
export type RetrievalPolicy = "all" | "mcp_only";

export type AgentTraceEvent = {
  kind: string;
  label: string;
  detail?: string;
  timestamp: string;
};

export type AgentRunInput = {
  question: string;
  sessionId?: string;
  researchMode: ResearchMode;
  audienceMode: AudienceMode;
  deepThink: boolean;
  searchEnabled: boolean;
  retrievalPolicy: RetrievalPolicy;
  maxIterations: number;
  requestTimeoutSeconds: number;
};

export type AgentExecutionResult = {
  sessionId?: string;
  message: string;
  reportMarkdown?: string;
  agentTrace?: AgentTraceEvent[];
  tools?: Array<Record<string, unknown>>;
  stderr?: string;
};

export type AgentExecutionHooks = {
  signal: AbortSignal;
  setSessionId: (sessionId: string) => void;
  onTrace: (event: AgentTraceEvent) => void;
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
  patient_summary?: string;
  agent_trace: AgentTraceEvent[];
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
  agentTrace: AgentTraceEvent[];
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
      message: "任务已创建，等待 DP循医 TypeScript Agent 运行。",
      agentTrace: [trace("run.queued", "任务已创建", "等待 Pi Agent 进程启动")],
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
    run.message = "DP循医 TypeScript Agent 正在检索和生成回答。";
    this.addTrace(run, trace("run.started", "任务已启动", `${run.input.researchMode} 模式`));
    try {
      const result = await this.executor(run.input, {
        signal: run.controller.signal,
        setSessionId: (sessionId) => {
          run.sessionId = sessionId;
        },
        onTrace: (event) => this.addTrace(run, event),
        onTool: (event) => this.addTool(run, event),
      });
      if (run.controller.signal.aborted) {
        this.markCancelled(run);
        return;
      }
      if (result.sessionId) run.sessionId = result.sessionId;
      if (result.reportMarkdown) run.reportMarkdown = result.reportMarkdown;
      for (const event of result.agentTrace ?? []) this.addTrace(run, event);
      for (const tool of result.tools ?? []) this.addTool(run, tool);
      run.status = "succeeded";
      run.completedAt = new Date().toISOString();
      run.message = result.message.trim() || "Agent 已完成，但没有生成可展示的文本。";
      this.addTrace(run, trace("run.completed", "任务完成", "已收到 Pi Agent 最终回答"));
    } catch (error) {
      if (run.controller.signal.aborted || isAbortError(error)) {
        this.markCancelled(run);
        return;
      }
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.message = "DP循医 TypeScript Agent 未能完成本次任务。";
      run.error = { code: "agent_execution_failed", message: errorMessage(error) };
      this.addTrace(run, trace("run.failed", "任务失败", run.error.message));
    }
  }

  private markCancelled(run: InternalRun): void {
    run.status = "cancelled";
    run.completedAt = new Date().toISOString();
    run.message = "任务已中断。";
    this.addTrace(run, trace("run.cancelled", "任务已中断", "Pi Agent 进程已收到取消信号"));
  }

  private addTrace(run: InternalRun, event: AgentTraceEvent): void {
    run.agentTrace.push(event);
    if (run.agentTrace.length > MAX_TRACE_EVENTS) run.agentTrace.splice(0, run.agentTrace.length - MAX_TRACE_EVENTS);
  }

  private addTool(run: InternalRun, event: Record<string, unknown>): void {
    run.tools.push(event);
    if (run.tools.length > MAX_TOOL_EVENTS) run.tools.splice(0, run.tools.length - MAX_TOOL_EVENTS);
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
      } : {}),
      agent_trace: [...run.agentTrace],
      tools: [...run.tools],
      summary: {
        research_mode: run.input.researchMode,
        audience_mode: run.input.audienceMode,
        deep_think: run.input.deepThink,
        search_enabled: run.input.searchEnabled,
        retrieval_policy: run.input.retrievalPolicy,
        max_iterations: run.input.maxIterations,
        max_iterations_is_advisory: true,
        request_timeout_seconds: run.input.requestTimeoutSeconds,
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
  corsOrigin?: string;
  maxCompletedRuns?: number;
};

export function createAgentApiServer(options: AgentApiServerOptions): { server: Server; store: AgentRunStore } {
  const store = new AgentRunStore(options.executor, options.maxCompletedRuns);
  const server = createServer((request, response) => {
    void handleRequest(request, response, store, options.corsOrigin ?? "*");
  });
  return { server, store };
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

async function handleRequest(request: IncomingMessage, response: ServerResponse, store: AgentRunStore, corsOrigin: string): Promise<void> {
  setCors(response, corsOrigin);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  try {
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "dp-xunyi-ts-agent-api",
        contract_version: CONTRACT_VERSION,
        endpoints: ["POST /api/v1/agent-runs", "GET /api/v1/agent-runs/{run_id}", "POST /api/v1/agent-runs/{run_id}/cancel"],
      });
      return;
    }
    if (request.method === "POST" && pathname === "/api/v1/agent-runs") {
      const input = validateAgentRunInput(await readJsonBody(request));
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
    throw new ApiError(404, "not_found", "未找到接口。");
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", errorMessage(error));
    sendJson(response, apiError.status, { ok: false, contract_version: CONTRACT_VERSION, error: { code: apiError.code, message: apiError.message } });
  }
}

function validateAgentRunInput(value: unknown): AgentRunInput {
  if (!isRecord(value)) throw new ApiError(400, "invalid_json", "请求体必须是 JSON 对象。");
  const question = requiredString(value.question, "question", 12_000);
  const attachments = value.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    throw new ApiError(422, "attachments_not_supported", "TypeScript 适配层首版尚未接入文件上传；请先移除附件，或继续使用旧 Python 后端处理附件。");
  }
  const researchMode = enumValue(value.research_mode, ["instant", "expert", "literature"] as const, "research_mode", "instant");
  const audienceMode = enumValue(value.audience_mode, ["clinician", "public"] as const, "audience_mode", "clinician");
  const maxIterations = boundedInteger(value.max_iterations, "max_iterations", 1, 24, researchMode === "instant" ? 5 : 12);
  const requestTimeoutSeconds = boundedInteger(value.request_timeout_seconds, "request_timeout_seconds", 30, 900, researchMode === "instant" ? 300 : 600);
  const retrievalPolicy = enumValue(value.retrieval_policy, ["all", "mcp_only"] as const, "retrieval_policy", "all");
  const sessionId = optionalString(value.session_id ?? value.ebm_session_id, "session_id", 200);
  return {
    question,
    ...(sessionId ? { sessionId } : {}),
    researchMode,
    audienceMode,
    deepThink: optionalBoolean(value.deep_think, "deep_think", false),
    searchEnabled: optionalBoolean(value.search_enabled, "search_enabled", true),
    retrievalPolicy,
    maxIterations,
    requestTimeoutSeconds,
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

async function readLatestFinalReport(rootDir: string, sessionId: string): Promise<string | undefined> {
  try {
    const sessionsRoot = path.join(rootDir, "data", "sessions");
    const mapping = JSON.parse(await readFile(path.join(sessionsRoot, ".metadata", "workspaces", `${sessionId}.json`), "utf8")) as { directory?: unknown };
    if (typeof mapping.directory !== "string" || !mapping.directory || path.basename(mapping.directory) !== mapping.directory) return undefined;
    const reportsDir = path.join(sessionsRoot, mapping.directory, "reports");
    const entries = (await readdir(reportsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
    const candidates = await Promise.all(entries.map(async (entry) => {
      const file = path.join(reportsDir, entry.name);
      return { file, modified: (await stat(file)).mtimeMs };
    }));
    const latest = candidates.sort((left, right) => right.modified - left.modified)[0];
    return latest ? (await readFile(latest.file, "utf8")).trim() : undefined;
  } catch {
    return undefined;
  }
}

async function runPiCli(input: { rootDir: string; piEntrypoint: string; request: AgentRunInput; hooks: AgentExecutionHooks; signal: AbortSignal }): Promise<AgentExecutionResult> {
  const { rootDir, piEntrypoint, request, hooks, signal } = input;
  const args = [
    piEntrypoint,
    "--mode", "json",
    "--approve",
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
  else args.push("--name", `DP循医-${new Date().toISOString().slice(0, 10)}`);
  args.push(buildAgentPrompt(request));

  const env = {
    ...process.env,
    ...(await projectEnv(rootDir)),
    PI_SKIP_VERSION_CHECK: "1",
    PI_CODING_AGENT_DIR: path.join(rootDir, "data", "pi-agent"),
    EBM_RETRIEVAL_POLICY: request.retrievalPolicy,
  };
  const child = spawn(process.execPath, args, { cwd: rootDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdoutBuffer = "";
  let stderr = "";
  let sessionId: string | undefined;
  let latestAnswer = "";
  const tools: Array<Record<string, unknown>> = [];
  const traceEvents: AgentTraceEvent[] = [];

  const addTrace = (event: AgentTraceEvent) => {
    traceEvents.push(event);
    if (traceEvents.length > MAX_TRACE_EVENTS) traceEvents.splice(0, traceEvents.length - MAX_TRACE_EVENTS);
    hooks.onTrace(event);
  };
  const addTool = (event: Record<string, unknown>) => {
    tools.push(event);
    if (tools.length > MAX_TOOL_EVENTS) tools.splice(0, tools.length - MAX_TOOL_EVENTS);
    hooks.onTool(event);
  };
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      addTrace(trace("pi.output", "Pi 输出无法解析", line.slice(0, 500)));
      return;
    }
    if (!isRecord(event)) return;
    if (event.type === "session" && typeof event.id === "string") {
      sessionId = event.id;
      hooks.setSessionId(sessionId);
      addTrace(trace("pi.session", "Pi 会话已创建", sessionId));
      return;
    }
    if (event.type === "tool_execution_start") {
      const name = typeof event.toolName === "string" ? event.toolName : "tool";
      addTool({ name, status: "running" });
      addTrace(trace("tool.started", `调用工具：${name}`, ""));
      return;
    }
    if (event.type === "tool_execution_end") {
      const name = typeof event.toolName === "string" ? event.toolName : "tool";
      addTool({ name, status: event.isError === true ? "error" : "completed" });
      addTrace(trace(event.isError === true ? "tool.failed" : "tool.completed", `${event.isError === true ? "工具失败" : "工具完成"}：${name}`, ""));
      return;
    }
    if (event.type === "message_update" && isRecord(event.assistantMessageEvent) && event.assistantMessageEvent.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
      latestAnswer += event.assistantMessageEvent.delta;
      return;
    }
    if (event.type === "message_end" && isRecord(event.message) && event.message.role === "assistant") {
      const text = contentText(event.message.content);
      if (text) latestAnswer = text;
      return;
    }
    if (event.type === "agent_start") addTrace(trace("agent.started", "Pi Agent 已启动", ""));
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
    if (exitCode !== 0) throw new Error(`Pi CLI exited with code ${exitCode}${stderr ? `: ${stderr}` : ""}`);
    const message = latestAnswer.trim();
    if (!message) throw new Error(`Pi CLI completed without a final assistant message${stderr ? `: ${stderr}` : ""}`);
    const reportMarkdown = sessionId ? await readLatestFinalReport(rootDir, sessionId) : undefined;
    return {
      ...(sessionId ? { sessionId } : {}),
      message,
      ...(reportMarkdown ? { reportMarkdown } : {}),
      ...(stderr ? { stderr } : {}),
    };
  } finally {
    signal.removeEventListener("abort", abort);
    if (forcedKill.value) clearTimeout(forcedKill.value);
  }
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

function buildAgentPrompt(input: AgentRunInput): string {
  const modeInstruction: Record<ResearchMode, string> = {
    instant: "以临床结论、安全边界和最少必要的可追溯证据为重点，避免不必要的扩展检索。",
    expert: "按 PICO 分解问题，解释指南、研究、效应量、适用性、冲突与不确定性。",
    literature: "以文献/指南阅读、证据摘录和引用可核验性为重点。",
  };
  const audienceInstruction = input.audienceMode === "public"
    ? "使用清晰中文面向普通用户，不给个体化处方，明确何时应就医。"
    : "使用面向临床人员的中文，保留 PICO、证据等级、效应量和适用边界。";
  const retrievalInstruction = input.retrievalPolicy === "mcp_only"
    ? "本轮是隔离的 MCP-only 集成测试：只使用 guideline_mcp_search、guideline_mcp_retrieve、guideline_mcp_read 及证据/报告工具；禁止 PubMed、公共网页和本地来源库检索。若指南证据不足，明确报告证据缺口，不得改用其他检索来源。最终面向用户的报告不得出现 MCP、RAG、工具调用、内部文件路径或内部 evidence ID。"
    : input.searchEnabled
      ? "可按需使用已配置的检索工具。"
      : "用户要求不进行外部检索；只使用当前会话中的既有材料。";
  return [
    "你是 DP循医的 TypeScript 后端 Agent。请输出中文、可追溯且不过度断言的循证回答。",
    modeInstruction[input.researchMode],
    audienceInstruction,
    input.deepThink ? "额外检查安全红旗、证据冲突和跨学科影响。" : "",
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

function boundedInteger(value: unknown, label: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ApiError(422, "invalid_request", `${label} 必须是 ${min} 到 ${max} 之间的整数。`);
  return value;
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
