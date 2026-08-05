import { createHash } from "node:crypto";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TrajectoryWriter } from "../observability/trajectory.js";
import { compactBeijingTimestamp } from "../tools/time.js";
import { readCurrentQueryMetadata } from "../observability/queryMetadata.js";
import { piSessionDirectory } from "./sessionPath.js";

type ActiveTool = { startedAt: number; toolName: string; args: unknown };
type ActiveProvider = {
  id: number;
  startedAt: number;
  headersAt?: number;
  firstDeltaAt?: number;
};

function elapsed(startedAt: number, endedAt = performance.now()): { duration_ms: number; duration_seconds: number } {
  const milliseconds = Math.max(0, endedAt - startedAt);
  return {
    duration_ms: Math.round(milliseconds * 100) / 100,
    duration_seconds: Math.round(milliseconds) / 1000,
  };
}

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, part) => {
    if (!part || typeof part !== "object") return sum;
    const record = part as Record<string, unknown>;
    return sum + (typeof record.text === "string" ? record.text.length : 0)
      + (typeof record.thinking === "string" ? record.thinking.length : 0);
  }, 0);
}

function contextSummary(messages: any[]): Record<string, unknown> {
  const roles: Record<string, number> = {};
  let chars = 0;
  for (const message of messages) {
    const role = typeof message?.role === "string" ? message.role : "unknown";
    roles[role] = (roles[role] ?? 0) + 1;
    chars += contentChars(message?.content);
  }
  return { message_count: messages.length, roles, content_chars: chars };
}

function providerPayloadSummary(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return { payload_type: typeof payload };
  const value = payload as Record<string, unknown>;
  return {
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(Array.isArray(value.messages) ? { message_count: value.messages.length } : {}),
    ...(Array.isArray(value.input) ? { input_count: value.input.length } : {}),
    ...(Array.isArray(value.tools) ? { tool_count: value.tools.length } : {}),
    ...(typeof value.max_tokens === "number" ? { max_tokens: value.max_tokens } : {}),
    ...(typeof value.max_output_tokens === "number" ? { max_output_tokens: value.max_output_tokens } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
  };
}

function selectedResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const keep = /^(?:retry-after|request-id|x-request-id|x-trace-id|x-ratelimit-|cf-ray)/i;
  return Object.fromEntries(Object.entries(headers).filter(([key]) => keep.test(key)));
}

function compactTimestamp(): string {
  return compactBeijingTimestamp().replace(/\.\d{3}\+0800$/, "+0800");
}

export function registerTrajectoryRecorder(pi: Pick<ExtensionAPI, "on" | "events">): void {
  let writer: TrajectoryWriter | undefined;
  let runId: string | undefined;
  let runCounter = 0;
  let turnIndex: number | undefined;
  let providerCounter = 0;
  let activeProvider: ActiveProvider | undefined;
  let runStartedAt: number | undefined;
  let agentStartedAt: number | undefined;
  let turnStartedAt: number | undefined;
  let pendingSessionStart: Record<string, unknown> | undefined;
  const activeTools = new Map<string, ActiveTool>();

  const ensureWriter = (ctx: any): TrajectoryWriter => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!writer) {
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      writer = new TrajectoryWriter(path.join(sessionDir, "trace"), sessionId);
    }
    return writer;
  };
  const record = (ctx: any, event: string, data?: unknown, preserveLongStrings = false) => ensureWriter(ctx).record({
    event,
    data,
    ...(runId ? { runId } : {}),
    ...(turnIndex === undefined ? {} : { turnIndex }),
    preserveLongStrings,
  });

  if (typeof pi.events?.on === "function") {
    pi.events.on("ebm:stream_stalled", (data) => {
      void writer?.record({
        event: "stream_stalled",
        data,
        ...(runId ? { runId } : {}),
        ...(turnIndex === undefined ? {} : { turnIndex }),
      });
    });
    pi.events.on("ebm:system_reminder", (data) => {
      void writer?.record({
        event: "system_reminder",
        data: { ...(data && typeof data === "object" ? data : {}), prompt_kind: "system_reminder" },
        ...(runId ? { runId } : {}),
        ...(turnIndex === undefined ? {} : { turnIndex }),
      });
    });
  }

  pi.on("session_start", async (event, ctx) => {
    writer = undefined;
    runId = undefined;
    turnIndex = undefined;
    activeTools.clear();
    activeProvider = undefined;
    runStartedAt = undefined;
    agentStartedAt = undefined;
    turnStartedAt = undefined;
    pendingSessionStart = {
      reason: event.reason,
      previous_session_file: event.previousSessionFile,
      session_file: ctx.sessionManager.getSessionFile?.(),
    };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (pendingSessionStart) {
      await record(ctx, "session_start", pendingSessionStart);
      pendingSessionStart = undefined;
    }
    runCounter += 1;
    const query = await readCurrentQueryMetadata(piSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId()));
    runId = query?.query_id || `${compactTimestamp()}-${runCounter}`;
    turnIndex = undefined;
    runStartedAt = performance.now();
    const skills = Array.isArray(event.systemPromptOptions?.skills)
      ? event.systemPromptOptions.skills.map((skill: any) => skill?.name).filter(Boolean)
      : [];
    await record(ctx, "run_start", {
      prompt: event.prompt,
      prompt_kind: "user_query",
      user_query: query?.question ?? event.prompt,
      ...(query ? { query_id: query.query_id } : {}),
      runtime: {
        provider: ctx.model?.provider,
        model: ctx.model?.id,
        thinking_level: (pi as ExtensionAPI).getThinkingLevel?.(),
        system_prompt_chars: event.systemPrompt.length,
        system_prompt_sha256: createHash("sha256").update(event.systemPrompt).digest("hex"),
        selected_tools: event.systemPromptOptions?.selectedTools ?? [],
        skills,
      },
    }, true);
  });

  pi.on("agent_start", async (_event, ctx) => {
    agentStartedAt = performance.now();
    await record(ctx, "agent_start");
  });
  pi.on("agent_end", async (event, ctx) => record(ctx, "agent_end", {
    generated_message_count: event.messages.length,
    ...(agentStartedAt === undefined ? {} : elapsed(agentStartedAt)),
  }));
  pi.on("agent_settled", async (_event, ctx) => record(ctx, "run_settled", {
    context_usage: ctx.getContextUsage?.(),
    ...(runStartedAt === undefined ? {} : elapsed(runStartedAt)),
  }));

  pi.on("turn_start", async (event, ctx) => {
    turnIndex = event.turnIndex;
    turnStartedAt = performance.now();
    await record(ctx, "turn_start", { pi_timestamp: event.timestamp });
  });
  pi.on("turn_end", async (event, ctx) => record(ctx, "turn_end", {
    tool_result_count: event.toolResults.length,
    stop_reason: event.message?.role === "assistant" ? event.message.stopReason : undefined,
    context_usage: ctx.getContextUsage?.(),
    ...(turnStartedAt === undefined ? {} : elapsed(turnStartedAt)),
  }));

  pi.on("context", async (event, ctx) => record(ctx, "context_snapshot", {
    ...contextSummary(event.messages),
    context_usage: ctx.getContextUsage?.(),
  }));

  pi.on("message_update", async (event, ctx) => {
    const deltaType = event.assistantMessageEvent.type;
    if (!activeProvider || activeProvider.firstDeltaAt !== undefined || !["thinking_delta", "text_delta", "toolcall_delta"].includes(deltaType)) return;
    activeProvider.firstDeltaAt = performance.now();
    await record(ctx, "model_first_delta", {
      request_index: activeProvider.id,
      delta_type: deltaType,
      ...elapsed(activeProvider.startedAt, activeProvider.firstDeltaAt),
    });
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const request = activeProvider;
    activeProvider = undefined;
    await record(ctx, "assistant_message", {
      ...event.message,
      request_timing: request ? {
        request_index: request.id,
        ...elapsed(request.startedAt),
        ...(request.headersAt === undefined ? {} : {
          headers_seconds: elapsed(request.startedAt, request.headersAt).duration_seconds,
        }),
        ...(request.firstDeltaAt === undefined ? {} : {
          first_delta_seconds: elapsed(request.startedAt, request.firstDeltaAt).duration_seconds,
        }),
      } : undefined,
    }, true);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    activeTools.set(event.toolCallId, { startedAt: performance.now(), toolName: event.toolName, args: event.args });
    await record(ctx, "tool_start", {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      args: event.args,
    });
  });
  pi.on("tool_execution_end", async (event, ctx) => {
    const active = activeTools.get(event.toolCallId);
    activeTools.delete(event.toolCallId);
    await record(ctx, "tool_end", {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      is_error: event.isError,
      ...(active ? elapsed(active.startedAt) : {}),
      result: event.result,
    });
  });

  pi.on("before_provider_request", async (event, ctx) => {
    activeProvider = { id: ++providerCounter, startedAt: performance.now() };
    await record(ctx, "provider_request", {
      request_index: activeProvider.id,
      provider: ctx.model?.provider,
      model: ctx.model?.id,
      payload: providerPayloadSummary(event.payload),
    });
  });
  pi.on("after_provider_response", async (event, ctx) => {
    const request = activeProvider;
    if (request) request.headersAt = performance.now();
    await record(ctx, "provider_response", {
      request_index: request?.id,
      provider: ctx.model?.provider,
      model: ctx.model?.id,
      status: event.status,
      ...(request ? elapsed(request.startedAt, request.headersAt) : {}),
      headers: selectedResponseHeaders(event.headers),
    });
  });

  pi.on("model_select", async (event, ctx) => record(ctx, "model_select", {
    source: event.source,
    previous: event.previousModel ? `${event.previousModel.provider}/${event.previousModel.id}` : undefined,
    current: `${event.model.provider}/${event.model.id}`,
  }));
  pi.on("thinking_level_select", async (event, ctx) => record(ctx, "thinking_level_select", {
    previous: event.previousLevel,
    current: event.level,
  }));
  pi.on("session_compact", async (event, ctx) => record(ctx, "compaction", {
    reason: event.reason,
    will_retry: event.willRetry,
    from_extension: event.fromExtension,
    entry_id: event.compactionEntry.id,
    tokens_before: event.compactionEntry.tokensBefore,
  }));
  pi.on("session_tree", async (event, ctx) => record(ctx, "session_tree", {
    old_leaf_id: event.oldLeafId,
    new_leaf_id: event.newLeafId,
    summary_entry_id: event.summaryEntry?.id,
  }));
  pi.on("session_shutdown", async (event, ctx) => {
    await record(ctx, "session_shutdown", { reason: event.reason, target_session_file: event.targetSessionFile });
    await writer?.flush();
  });
}
