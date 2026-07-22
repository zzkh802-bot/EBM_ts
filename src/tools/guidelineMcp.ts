import { archiveSource, type SourceArchiveRecord } from "./archive.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
};

export type GuidelineToolResult = { text: string; raw: unknown };
export type GuidelineClient = { callTool(name: "search" | "read", argumentsValue: Record<string, unknown>): Promise<GuidelineToolResult> };

export type GuidelineResult =
  | { ok: true; archive: SourceArchiveRecord }
  | { ok: false; error: { code: "mcp_error"; message: string } };

export class GuidelineMcpClient implements GuidelineClient {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private sessionId?: string;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private nextId = 1;
  private initialized?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: { endpoint: string; fetcher?: typeof fetch; timeoutMs?: number }) {
    this.endpoint = options.endpoint;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  callTool(name: "search" | "read", argumentsValue: Record<string, unknown>): Promise<GuidelineToolResult> {
    const run = this.tail.then(() => this.callToolSerial(name, argumentsValue));
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async callToolSerial(name: "search" | "read", argumentsValue: Record<string, unknown>): Promise<GuidelineToolResult> {
    this.initialized ??= this.initialize();
    await this.initialized;
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: argumentsValue },
    });
    if (!response || !response.result || typeof response.result !== "object") throw new Error("MCP tools/call response has no result");
    const result = response.result as { content?: unknown; structuredContent?: unknown; isError?: unknown };
    const text = Array.isArray(result.content)
      ? result.content
        .filter((item): item is { type: string; text: string } => Boolean(item && typeof item === "object" && (item as any).type === "text" && typeof (item as any).text === "string"))
        .map((item) => item.text)
        .join("\n")
      : "";
    if (result.isError === true) throw new Error(`MCP ${name} failed: ${text || "unknown tool error"}`);
    const effectiveText = text || (result.structuredContent === undefined ? "" : JSON.stringify(result.structuredContent));
    if (!effectiveText.trim()) throw new Error(`MCP ${name} returned no readable content`);
    return { text: effectiveText, raw: result };
  }

  private async initialize(): Promise<void> {
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "ebm-agent-ts", version: "0.1.0" },
      },
    }, false);
    if (!response?.result || typeof response.result !== "object") throw new Error("MCP initialize response has no result");
    const negotiated = (response.result as { protocolVersion?: unknown }).protocolVersion;
    if (typeof negotiated !== "string" || !negotiated) throw new Error("MCP initialize response has no protocolVersion");
    this.protocolVersion = negotiated;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  private async post(payload: Record<string, unknown>, includeProtocol = true): Promise<JsonRpcResponse | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`MCP request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(includeProtocol ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`MCP request timed out after ${this.timeoutMs}ms`, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) this.sessionId = newSessionId;
    if (!response.ok) {
      const body = (await response.text()).trim().slice(0, 500);
      throw new Error(`MCP HTTP ${response.status}: ${body || response.statusText}`);
    }
    if (response.status === 202 || response.status === 204) return undefined;
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: unknown;
    try {
      if (contentType.includes("text/event-stream")) {
        const data = body.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter((line) => line && line !== "[DONE]")
          .at(-1);
        if (!data) throw new Error("SSE response has no data event");
        parsed = JSON.parse(data);
      } else {
        parsed = JSON.parse(body);
      }
    } catch (error) {
      throw new Error(`MCP response contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== "object") throw new Error("MCP response is not a JSON object");
    const rpc = parsed as JsonRpcResponse;
    if (rpc.error) {
      throw new Error(`MCP JSON-RPC error ${String(rpc.error.code ?? "unknown")}: ${String(rpc.error.message ?? "unknown error")}`);
    }
    return rpc;
  }
}

export async function searchGuidelines(input: {
  sessionDir: string;
  query: string;
  client: GuidelineClient;
  topk?: number;
  sourceInstitution?: string;
  clinicalDepartment?: string;
}): Promise<GuidelineResult> {
  try {
    const result = await input.client.callTool("search", {
      query: input.query,
      topk: Math.min(Math.max(input.topk ?? 5, 1), 20),
      ...(input.sourceInstitution ? { source_institution: input.sourceInstitution } : {}),
      ...(input.clinicalDepartment ? { clinical_department: input.clinicalDepartment } : {}),
    });
    const content = `# Guideline search: ${input.query}\n\n${result.text}`;
    return {
      ok: true,
      archive: await archiveSource({ sessionDir: input.sessionDir, kind: "search", title: input.query, content }),
    };
  } catch (error) {
    return { ok: false, error: { code: "mcp_error", message: error instanceof Error ? error.message : String(error) } };
  }
}

function extractGuidelineDocument(text: string): { content: string; title?: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const content = typeof record.content === "string" ? record.content : undefined;
      const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : undefined;
      if (content?.trim()) return { content, ...(title ? { title } : {}) };
    }
  } catch {
    // Plain Markdown is already the desired document representation.
  }
  return { content: text };
}

export async function readGuideline(input: {
  sessionDir: string;
  client: GuidelineClient;
  docId?: string;
  title?: string;
  maxChars?: number;
}): Promise<GuidelineResult> {
  if (!input.docId && !input.title) return { ok: false, error: { code: "mcp_error", message: "docId or title is required" } };
  try {
    const result = await input.client.callTool("read", {
      ...(input.docId ? { doc_id: input.docId } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.maxChars === undefined ? {} : { max_chars: input.maxChars }),
    });
    const document = extractGuidelineDocument(result.text);
    return {
      ok: true,
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        title: document.title ?? input.title ?? input.docId ?? "guideline",
        content: document.content,
      }),
    };
  } catch (error) {
    return { ok: false, error: { code: "mcp_error", message: error instanceof Error ? error.message : String(error) } };
  }
}
