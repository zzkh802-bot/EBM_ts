import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatBeijingTimestamp } from "../tools/time.js";

export type TrajectoryRecord = {
  schema_version: 1;
  timestamp: string;
  sequence: number;
  session_id: string;
  run_id?: string;
  turn_index?: number;
  event: string;
  data: unknown;
};

const SECRET_KEY = /^(?:api[_-]?key|authorization|password|passwd|secret|token|access|refresh|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|cookie|set-cookie)$/i;

function redactText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;}\]]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|refresh_token|token|key)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/https:\/\/(?:open\.feishu\.cn|open\.larksuite\.com)\/open-apis\/bot\/v2\/hook\/[^\s"'?#]+/gi, "[REDACTED_LARK_WEBHOOK]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]");
}

function sanitize(value: unknown, key = "", preserveLongStrings = false): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    const redacted = redactText(value);
    if (preserveLongStrings || redacted.length <= 12_000) return redacted;
    return { truncated: true, chars: redacted.length, preview: redacted.slice(0, 12_000) };
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, "", preserveLongStrings));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      childKey,
      sanitize(child, childKey, preserveLongStrings),
    ]));
  }
  return value;
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028|\u2029/g, (match) => match === "\u2028" ? "\\u2028" : "\\u2029");
}

function markdownFence(content: string, language = ""): string {
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function blockText(value: unknown): string {
  return markdownFence(JSON.stringify(value, null, 2), "json");
}

function formatAssistant(data: any): string[] {
  const lines = ["### Assistant message", ""];
  if (data.provider || data.model) lines.push(`- Model: ${data.provider ?? "unknown"}/${data.model ?? "unknown"}`);
  if (data.stopReason) lines.push(`- Stop reason: ${data.stopReason}`);
  if (data.usage) lines.push(`- Usage: ${JSON.stringify(data.usage)}`);
  if (data.request_timing) lines.push(`- Model timing: ${JSON.stringify(data.request_timing)}`);
  lines.push("");
  for (const part of Array.isArray(data.content) ? data.content : []) {
    if (part?.type === "thinking") lines.push("#### Thinking", "", markdownFence(String(part.thinking ?? "")), "");
    else if (part?.type === "text") lines.push("#### Response", "", String(part.text ?? ""), "");
    else if (part?.type === "toolCall") lines.push(`#### Planned tool: ${part.name ?? "unknown"}`, "", blockText(part.arguments ?? {}), "");
  }
  return lines;
}

function formatMarkdown(record: TrajectoryRecord): string {
  const meta = [`time=${record.timestamp}`, `seq=${record.sequence}`];
  if (record.run_id) meta.push(`run=${record.run_id}`);
  if (record.turn_index !== undefined) meta.push(`turn=${record.turn_index}`);
  const data = record.data as any;
  const lines: string[] = [];
  switch (record.event) {
    case "run_start":
      lines.push(`## Run ${record.run_id}`, "", `- ${meta.join(" · ")}`, "", "### User query", "", String(data.user_query ?? data.prompt ?? ""), "", "### Agent prompt", "", String(data.prompt ?? ""), "");
      if (data.runtime) lines.push("### Runtime", "", blockText(data.runtime), "");
      break;
    case "turn_start":
      lines.push(`### Turn ${(record.turn_index ?? 0) + 1}`, "", `_${meta.join(" · ")}_`, "");
      break;
    case "assistant_message":
      lines.push(...formatAssistant(data));
      break;
    case "tool_start":
      lines.push(`### Tool start: ${data.tool_name ?? "unknown"}`, "", `- Call: ${data.tool_call_id ?? "unknown"}`, `- ${meta.join(" · ")}`, "", blockText(data.args ?? {}), "");
      break;
    case "tool_end":
      lines.push(`### Tool end: ${data.tool_name ?? "unknown"}`, "", `- Call: ${data.tool_call_id ?? "unknown"}`, `- Status: ${data.is_error ? "error" : "success"}`, `- Duration: ${data.duration_seconds ?? "?"} s (${data.duration_ms ?? "?"} ms)`, "", blockText(data.result ?? {}), "");
      break;
    case "provider_request":
    case "provider_response":
    case "context_snapshot":
    case "compaction":
      lines.push(`### ${record.event.replaceAll("_", " ")}`, "", `_${meta.join(" · ")}_`, "", blockText(data), "");
      break;
    case "run_settled":
      lines.push("### Run settled", "", `- Total elapsed: ${data.duration_seconds ?? "?"} s`, `_${meta.join(" · ")}_`, "");
      break;
    default:
      lines.push(`### ${record.event.replaceAll("_", " ")}`, "", `_${meta.join(" · ")}_`, "", blockText(data), "");
  }
  return `${lines.join("\n")}\n`;
}

export class TrajectoryWriter {
  readonly jsonlPath: string;
  readonly markdownPath: string;
  private sequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly traceDir: string, private readonly sessionId: string) {
    this.jsonlPath = path.join(traceDir, "trajectory.jsonl");
    this.markdownPath = path.join(traceDir, "trajectory.md");
  }

  record(input: {
    event: string;
    data?: unknown;
    runId?: string;
    turnIndex?: number;
    preserveLongStrings?: boolean;
  }): Promise<void> {
    const record: TrajectoryRecord = {
      schema_version: 1,
      timestamp: formatBeijingTimestamp(),
      sequence: ++this.sequence,
      session_id: this.sessionId,
      ...(input.runId ? { run_id: input.runId } : {}),
      ...(input.turnIndex === undefined ? {} : { turn_index: input.turnIndex }),
      event: input.event,
      data: sanitize(input.data ?? {}, "", input.preserveLongStrings),
    };
    this.queue = this.queue.then(async () => {
      await this.initialize();
      await Promise.all([
        appendFile(this.jsonlPath, `${jsonLine(record)}\n`, { encoding: "utf8", mode: 0o600 }),
        appendFile(this.markdownPath, `\n${formatMarkdown(record)}`, { encoding: "utf8", mode: 0o600 }),
      ]);
    });
    return this.queue;
  }

  flush(): Promise<void> {
    return this.queue;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.traceDir, { recursive: true, mode: 0o700 });
    try {
      await readFile(this.markdownPath, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await writeFile(this.markdownPath, `# Agent Trajectory\n\nSession: ${this.sessionId}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    }
    try {
      await writeFile(this.jsonlPath, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    await Promise.all([chmod(this.markdownPath, 0o600), chmod(this.jsonlPath, 0o600)]);
    this.initialized = true;
  }
}
