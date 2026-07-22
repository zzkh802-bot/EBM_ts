import type { TrajectoryRecord } from "./trajectory.js";

export type ToolAnalysis = {
  calls: number;
  errors: number;
  total_duration_ms: number;
  average_duration_ms: number;
  total_duration_seconds: number;
  average_duration_seconds: number;
};

export type TrajectoryAnalysis = {
  session_id: string;
  runs: number;
  turns: number;
  assistant_messages: number;
  thinking_chars: number;
  response_chars: number;
  tool_calls: number;
  tool_errors: number;
  duplicate_tool_actions: number;
  provider_requests: number;
  provider_errors: number;
  compactions: number;
  total_elapsed_seconds: number;
  average_first_delta_seconds?: number;
  average_model_completion_seconds?: number;
  average_provider_headers_seconds?: number;
  first_evidence_add_delay_ms?: number;
  first_evidence_add_delay_seconds?: number;
  first_evidence_add_turn?: number;
  full_text_reads: number;
  abstract_only_reads: number;
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
    total: number;
    cost: number;
  };
  tools: Record<string, ToolAnalysis>;
  run_summaries: Array<{
    run_id: string;
    duration_ms?: number;
    duration_seconds?: number;
    turns: number;
    tool_calls: number;
    tool_errors: number;
  }>;
};

export type { TrajectoryRecord } from "./trajectory.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function charsFor(message: any, type: "thinking" | "text"): number {
  if (!Array.isArray(message?.content)) return 0;
  return message.content.reduce((total: number, part: any) => {
    if (part?.type !== type) return total;
    const value = type === "thinking" ? part.thinking : part.text;
    return total + (typeof value === "string" ? value.length : 0);
  }, 0);
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function milliseconds(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function analyzeTrajectory(records: TrajectoryRecord[]): TrajectoryAnalysis {
  const sessionId = records[0]?.session_id ?? "unknown";
  const runStarts = new Map<string, string>();
  const runEnds = new Map<string, string>();
  const runTurns = new Map<string, Set<number>>();
  const runToolCalls = new Map<string, number>();
  const runToolErrors = new Map<string, number>();
  const toolStarts = new Map<string, { name: string; args: unknown; runId?: string }>();
  const tools: Record<string, ToolAnalysis> = {};
  const actionCounts = new Map<string, number>();
  const turns = new Set<string>();
  let assistantMessages = 0;
  let thinkingChars = 0;
  let responseChars = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let providerRequests = 0;
  let providerErrors = 0;
  let compactions = 0;
  const firstDeltaSeconds: number[] = [];
  const modelCompletionSeconds: number[] = [];
  const providerHeadersSeconds: number[] = [];
  let firstEvidenceTimestamp: string | undefined;
  let firstEvidenceTurn: number | undefined;
  let fullTextReads = 0;
  let abstractOnlyReads = 0;
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, cost: 0 };

  for (const record of records) {
    const run = record.run_id;
    if (run && record.turn_index !== undefined) {
      turns.add(`${run}:${record.turn_index}`);
      const set = runTurns.get(run) ?? new Set<number>();
      set.add(record.turn_index);
      runTurns.set(run, set);
    }
    const data = record.data as any;
    if (record.event === "run_start" && run) runStarts.set(run, record.timestamp);
    if (record.event === "run_settled" && run) runEnds.set(run, record.timestamp);
    if (record.event === "assistant_message") {
      assistantMessages += 1;
      thinkingChars += charsFor(data, "thinking");
      responseChars += charsFor(data, "text");
      const usage = data?.usage;
      if (usage) {
        tokens.input += numeric(usage.input);
        tokens.output += numeric(usage.output);
        tokens.cache_read += numeric(usage.cacheRead);
        tokens.cache_write += numeric(usage.cacheWrite);
        tokens.total += numeric(usage.totalTokens);
        tokens.cost += numeric(usage.cost?.total);
      }
    }
    if (record.event === "tool_start") {
      toolCalls += 1;
      const name = String(data?.tool_name ?? "unknown");
      const callId = String(data?.tool_call_id ?? `missing-${record.sequence}`);
      toolStarts.set(callId, { name, args: data?.args, ...(run ? { runId: run } : {}) });
      runToolCalls.set(run ?? "unknown", (runToolCalls.get(run ?? "unknown") ?? 0) + 1);
      const actionKey = `${name}:${JSON.stringify(stable(data?.args))}`;
      actionCounts.set(actionKey, (actionCounts.get(actionKey) ?? 0) + 1);
      if (name === "evidence_add" && firstEvidenceTimestamp === undefined) {
        firstEvidenceTimestamp = record.timestamp;
        firstEvidenceTurn = record.turn_index === undefined ? undefined : record.turn_index + 1;
      }
      tools[name] ??= {
        calls: 0, errors: 0, total_duration_ms: 0, average_duration_ms: 0,
        total_duration_seconds: 0, average_duration_seconds: 0,
      };
      tools[name].calls += 1;
    }
    if (record.event === "tool_end") {
      const name = String(data?.tool_name ?? toolStarts.get(String(data?.tool_call_id))?.name ?? "unknown");
      tools[name] ??= {
        calls: 0, errors: 0, total_duration_ms: 0, average_duration_ms: 0,
        total_duration_seconds: 0, average_duration_seconds: 0,
      };
      const duration = Number(data?.duration_ms ?? 0);
      if (Number.isFinite(duration)) tools[name].total_duration_ms += duration;
      if (data?.is_error === true) {
        toolErrors += 1;
        tools[name].errors += 1;
        runToolErrors.set(run ?? "unknown", (runToolErrors.get(run ?? "unknown") ?? 0) + 1);
      }
      if (name === "pubmed_read") {
        const fullText = data?.result?.details?.fullText;
        if (fullText === true) fullTextReads += 1;
        if (fullText === false) abstractOnlyReads += 1;
      }
    }
    if (record.event === "provider_request") providerRequests += 1;
    if (record.event === "provider_response") {
      if (Number(data?.status ?? 0) >= 400) providerErrors += 1;
      if (numeric(data?.duration_seconds) > 0) providerHeadersSeconds.push(numeric(data.duration_seconds));
    }
    if (record.event === "model_first_delta" && numeric(data?.duration_seconds) > 0) firstDeltaSeconds.push(numeric(data.duration_seconds));
    if (record.event === "assistant_message" && numeric(data?.request_timing?.duration_seconds) > 0) modelCompletionSeconds.push(numeric(data.request_timing.duration_seconds));
    if (record.event === "compaction") compactions += 1;
  }

  for (const value of Object.values(tools)) {
    value.average_duration_ms = value.calls ? Math.round((value.total_duration_ms / value.calls) * 100) / 100 : 0;
    value.total_duration_seconds = Math.round(value.total_duration_ms) / 1000;
    value.average_duration_seconds = value.calls ? Math.round((value.total_duration_seconds / value.calls) * 1000) / 1000 : 0;
  }
  const firstRunStart = [...runStarts.values()].sort()[0];
  const firstEvidenceDelay = milliseconds(firstRunStart, firstEvidenceTimestamp);
  const runIds = [...new Set([...runStarts.keys(), ...runEnds.keys(), ...runTurns.keys()])];
  const runDurations = runIds.map((id) => milliseconds(runStarts.get(id), runEnds.get(id))).filter((value): value is number => value !== undefined);
  const average = (values: number[]): number | undefined => values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    : undefined;
  const averageFirstDelta = average(firstDeltaSeconds);
  const averageModelCompletion = average(modelCompletionSeconds);
  const averageProviderHeaders = average(providerHeadersSeconds);

  return {
    session_id: sessionId,
    runs: runIds.length,
    turns: turns.size,
    assistant_messages: assistantMessages,
    thinking_chars: thinkingChars,
    response_chars: responseChars,
    tool_calls: toolCalls,
    tool_errors: toolErrors,
    duplicate_tool_actions: [...actionCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    provider_requests: providerRequests,
    provider_errors: providerErrors,
    compactions,
    total_elapsed_seconds: Math.round(runDurations.reduce((sum, value) => sum + value, 0)) / 1000,
    ...(averageFirstDelta === undefined ? {} : { average_first_delta_seconds: averageFirstDelta }),
    ...(averageModelCompletion === undefined ? {} : { average_model_completion_seconds: averageModelCompletion }),
    ...(averageProviderHeaders === undefined ? {} : { average_provider_headers_seconds: averageProviderHeaders }),
    ...(firstEvidenceDelay === undefined ? {} : {
      first_evidence_add_delay_ms: firstEvidenceDelay,
      first_evidence_add_delay_seconds: Math.round(firstEvidenceDelay) / 1000,
    }),
    ...(firstEvidenceTurn === undefined ? {} : { first_evidence_add_turn: firstEvidenceTurn }),
    full_text_reads: fullTextReads,
    abstract_only_reads: abstractOnlyReads,
    tokens,
    tools,
    run_summaries: runIds.map((runId) => {
      const duration = milliseconds(runStarts.get(runId), runEnds.get(runId));
      return {
        run_id: runId,
        ...(duration === undefined ? {} : { duration_ms: duration, duration_seconds: Math.round(duration) / 1000 }),
        turns: runTurns.get(runId)?.size ?? 0,
        tool_calls: runToolCalls.get(runId) ?? 0,
        tool_errors: runToolErrors.get(runId) ?? 0,
      };
    }),
  };
}
