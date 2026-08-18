import type { TrajectoryRecord } from "./trajectory.js";

export type ToolAnalysis = {
  calls: number;
  errors: number;
  total_duration_ms: number;
  average_duration_ms: number;
  total_duration_seconds: number;
  average_duration_seconds: number;
};

export type PhaseAnalysis = {
  turns: number;
  elapsed_seconds: number;
  model_seconds: number;
  tool_wall_seconds: number;
  tool_sum_seconds: number;
  tool_calls: number;
  tool_errors: number;
  tool_result_chars: number;
  max_context_tokens: number;
};

export type EvidenceSourceKind =
  | "guideline_mcp_retrieve"
  | "guideline_mcp_read"
  | "pubmed"
  | "web"
  | "source_library"
  | "attachment"
  | "unknown";

export type EvidenceAttemptBreakdown = {
  calls: number;
  errors: number;
  first_attempts: number;
  first_attempt_failures: number;
};

export type EvidenceAttemptAnalysis = EvidenceAttemptBreakdown & {
  retries: number;
  retry_attempts: number;
  retry_successes: number;
  call_failure_rate: number;
  first_attempt_failure_rate: number;
  retry_success_rate: number;
  by_source: Partial<Record<EvidenceSourceKind, EvidenceAttemptBreakdown>>;
  /** source_span/source_id_quote/source_path_quote are retained only to read historical traces. */
  by_input_mode: Partial<Record<"read_id_anchors" | "read_id_range" | "line_anchors" | "source_span" | "source_id_quote" | "source_path_quote", EvidenceAttemptBreakdown>>;
  failure_reasons: Partial<Record<"input_contract" | "source_path" | "quote_not_located" | "quote_ambiguous" | "quote_quality" | "provenance_bounds" | "other", number>>;
};

export type TrajectoryAnalysis = {
  session_id: string;
  user_ids: string[];
  runs: number;
  user_queries: number;
  system_reminders: number;
  turns: number;
  assistant_messages: number;
  thinking_chars: number;
  response_chars: number;
  tool_calls: number;
  tool_errors: number;
  duplicate_tool_actions: number;
  provider_requests: number;
  provider_errors: number;
  provider_stream_stalls: number;
  provider_incomplete_after_headers: number;
  provider_incomplete_after_first_delta: number;
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
  phases: Record<string, PhaseAnalysis>;
  evidence_add_attempts: EvidenceAttemptAnalysis;
  run_summaries: Array<{
    run_id: string;
    user_id?: string;
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

function recordValue(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function canonicalSourcePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/^@/, "").replaceAll("\\", "/").replace(/^\.\//, "");
  const sessionMarker = normalized.match(/(?:^|\/)data\/sessions\/[^/]+\/(.+)$/);
  return sessionMarker?.[1] ?? normalized.replace(/^data\/sessions\/[^/]+\//, "");
}

function producedSourcePaths(toolName: string, result: unknown): Array<{ path: string; sourceId?: string; kind: EvidenceSourceKind }> {
  const resultRecord = recordValue(result);
  const details = recordValue(resultRecord?.details);
  if (!details) return [];
  if (toolName === "guideline_mcp_retrieve") {
    return Array.isArray(details.chunkArchives) ? details.chunkArchives.flatMap((item: unknown) => {
      const archive = recordValue(item);
      return typeof archive?.path === "string" ? [{ path: canonicalSourcePath(archive.path), ...(typeof archive.sourceId === "string" ? { sourceId: archive.sourceId } : {}), kind: "guideline_mcp_retrieve" as const }] : [];
    }) : [];
  }
  if (toolName === "guideline_mcp_read") {
    const archive = recordValue(details.archive);
    return typeof archive?.path === "string" ? [{ path: canonicalSourcePath(archive.path), ...(typeof archive.sourceId === "string" ? { sourceId: archive.sourceId } : {}), kind: "guideline_mcp_read" }] : [];
  }
  if (toolName === "pubmed_search" || toolName === "pubmed_similar") {
    return Array.isArray(details.abstractArchives) ? details.abstractArchives.flatMap((item: unknown) => {
      const archive = recordValue(item);
      return typeof archive?.path === "string" ? [{ path: canonicalSourcePath(archive.path), ...(typeof archive.sourceId === "string" ? { sourceId: archive.sourceId } : {}), kind: "pubmed" as const }] : [];
    }) : [];
  }
  if (toolName === "pubmed_read") {
    const archive = recordValue(details.archive);
    return typeof archive?.path === "string" ? [{ path: canonicalSourcePath(archive.path), ...(typeof archive.sourceId === "string" ? { sourceId: archive.sourceId } : {}), kind: "pubmed" }] : [];
  }
  if (toolName === "web_read") {
    const archive = recordValue(details.archive);
    if (typeof archive?.path !== "string") return [];
    return [{
      path: canonicalSourcePath(archive.path),
      ...(typeof archive.sourceId === "string" ? { sourceId: archive.sourceId } : {}),
      kind: details.provider === "library" ? "source_library" : "web",
    }];
  }
  return [];
}

function producedReadReceipts(toolName: string, result: unknown): Array<{ readId: string; path: string; sourceId?: string; kind?: EvidenceSourceKind }> {
  const resultRecord = recordValue(result);
  const details = recordValue(resultRecord?.details);
  if (!details) return [];
  if (toolName === "guideline_mcp_retrieve" && Array.isArray(details.chunkArchives)) {
    return details.chunkArchives.flatMap((item: unknown) => {
      const chunk = recordValue(item);
      if (typeof chunk?.readId !== "string" || typeof chunk.path !== "string") return [];
      return [{
        readId: chunk.readId,
        path: canonicalSourcePath(chunk.path),
        ...(typeof chunk.sourceId === "string" ? { sourceId: chunk.sourceId } : {}),
        kind: "guideline_mcp_retrieve" as const,
      }];
    });
  }
  if (typeof details.readId !== "string") return [];
  const archive = recordValue(details.archive);
  const rawPath = typeof details.sourcePath === "string" ? details.sourcePath : archive?.path;
  if (typeof rawPath !== "string" || !rawPath) return [];
  const kind: EvidenceSourceKind | undefined = toolName === "guideline_mcp_retrieve" || toolName === "guideline_mcp_read"
    ? toolName
    : toolName === "pubmed_read" ? "pubmed"
      : toolName === "web_read" ? (details.provider === "library" ? "source_library" : "web")
        : undefined;
  return [{
    readId: details.readId,
    path: canonicalSourcePath(rawPath),
    ...(typeof archive?.sourceId === "string" ? { sourceId: archive.sourceId } : {}),
    ...(kind ? { kind } : {}),
  }];
}

function toolResultText(result: unknown): string {
  const resultRecord = recordValue(result);
  if (!Array.isArray(resultRecord?.content)) return "";
  return resultRecord.content.map((item: unknown) => {
    const content = recordValue(item);
    if (typeof content?.text === "string") return content.text;
    const truncated = recordValue(content?.text);
    return typeof truncated?.preview === "string" ? truncated.preview : "";
  }).join("\n");
}

function evidenceFailureReason(result: unknown): keyof EvidenceAttemptAnalysis["failure_reasons"] {
  const details = recordValue(recordValue(result)?.details);
  if (details?.errorCode === "quote_ambiguous") return "quote_ambiguous";
  if (details?.errorCode === "quote_not_located") return "quote_not_located";
  const text = toolResultText(result);
  if (/provide .*source_span_id|provide read_id or line_start|exactly one of source_id|source_id does not match source_span_id/i.test(text)) return "input_contract";
  if (/source_path|ENOENT|no such file|unsafe relative path|outside session|different session workspace/i.test(text)) return "source_path";
  if (/primary_abstract evidence must stay inside|read_id.*(?:范围|range).*与边界文本不一致|PubMed Abstract lines/i.test(text)) return "provenance_bounds";
  if (/匹配到\s*\d+\s*处|排版归一化后的 quote .*匹配到/i.test(text)) return "quote_ambiguous";
  if (/quality check failed|quote appears to be|citation evidence/i.test(text)) return "quote_quality";
  if (/未能在归档来源中唯一定位|没有找到可靠的原文候选|quote.*(?:locat|match)/i.test(text)) return "quote_not_located";
  return "other";
}

function emptyEvidenceBreakdown(): EvidenceAttemptBreakdown {
  return { calls: 0, errors: 0, first_attempts: 0, first_attempt_failures: 0 };
}

export function analyzeTrajectory(records: TrajectoryRecord[]): TrajectoryAnalysis {
  const sessionId = records[0]?.session_id ?? "unknown";
  const runStarts = new Map<string, string>();
  const runUsers = new Map<string, string>();
  const runEnds = new Map<string, string>();
  const runTurns = new Map<string, Set<number>>();
  const runToolCalls = new Map<string, number>();
  const runToolErrors = new Map<string, number>();
  const toolStarts = new Map<string, { name: string; args: unknown; runId?: string }>();
  const tools: Record<string, ToolAnalysis> = {};
  const actionCounts = new Map<string, number>();
  const turns = new Set<string>();
  let assistantMessages = 0;
  let userQueries = 0;
  let systemReminders = 0;
  let thinkingChars = 0;
  let responseChars = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let providerRequests = 0;
  let providerErrors = 0;
  let providerStreamStalls = 0;
  const providerLifecycles = new Map<string, { responseOk: boolean; firstDelta: boolean; completed: boolean }>();
  let compactions = 0;
  const firstDeltaSeconds: number[] = [];
  const modelCompletionSeconds: number[] = [];
  const providerHeadersSeconds: number[] = [];
  let firstEvidenceTimestamp: string | undefined;
  let firstEvidenceTurn: number | undefined;
  let fullTextReads = 0;
  let abstractOnlyReads = 0;
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0, cost: 0 };
  const evidenceAddAttempts: EvidenceAttemptAnalysis = {
    ...emptyEvidenceBreakdown(),
    retries: 0,
    retry_attempts: 0,
    retry_successes: 0,
    call_failure_rate: 0,
    first_attempt_failure_rate: 0,
    retry_success_rate: 0,
    by_source: {},
    by_input_mode: {},
    failure_reasons: {},
  };
  const sourceKinds = new Map<string, { kind: EvidenceSourceKind; sourceId?: string }>();
  const sourceIdKinds = new Map<string, EvidenceSourceKind>();
  const readKinds = new Map<string, { path: string; kind: EvidenceSourceKind; sourceId?: string }>();
  const seenEvidenceTargets = new Set<string>();
  const activeEvidenceAttempts = new Map<string, {
    first: boolean;
    source: EvidenceSourceKind;
    mode: "read_id_anchors" | "read_id_range" | "line_anchors" | "source_span" | "source_id_quote" | "source_path_quote";
    question: string;
    claim: string;
  }>();
  type TurnState = {
    runId: string;
    index: number;
    elapsedMs: number;
    modelMs: number;
    contextTokens: number;
    toolResultChars: number;
    tools: Array<{ id: string; name: string; startMs: number; endMs?: number; durationMs: number; error: boolean }>;
  };
  const turnStates = new Map<string, TurnState>();
  const turnState = (runId: string, index: number): TurnState => {
    const key = `${runId}:${index}`;
    const existing = turnStates.get(key);
    if (existing) return existing;
    const created: TurnState = { runId, index, elapsedMs: 0, modelMs: 0, contextTokens: 0, toolResultChars: 0, tools: [] };
    turnStates.set(key, created);
    return created;
  };

  for (const record of records) {
    const run = record.run_id;
    if (run && record.turn_index !== undefined) {
      turns.add(`${run}:${record.turn_index}`);
      const set = runTurns.get(run) ?? new Set<number>();
      set.add(record.turn_index);
      runTurns.set(run, set);
    }
    const data = record.data as any;
    const state = run && record.turn_index !== undefined ? turnState(run, record.turn_index) : undefined;
    if (state && record.event === "context_snapshot") state.contextTokens = numeric(data?.context_usage?.tokens);
    if (state && record.event === "turn_end") state.elapsedMs = numeric(data?.duration_ms);
    if (state && record.event === "assistant_message") state.modelMs = numeric(data?.request_timing?.duration_ms);
    if (record.event === "run_start" && run) {
      runStarts.set(run, record.timestamp);
      if (typeof data?.user_id === "string" && data.user_id.trim()) runUsers.set(run, data.user_id.trim());
      if (data?.prompt_kind !== "system_reminder") userQueries += 1;
    }
    if (record.event === "system_reminder") systemReminders += 1;
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
      state?.tools.push({ id: callId, name, startMs: Date.parse(record.timestamp), durationMs: 0, error: false });
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
      if (name === "evidence_add") {
        const args = recordValue(data?.args) ?? {};
        const readId = typeof args.read_id === "string" ? args.read_id : undefined;
        const readSource = readId ? readKinds.get(`${record.session_id}:${readId}`) : undefined;
        const sourcePath = canonicalSourcePath(args.source_path ?? readSource?.path);
        const spanSourceId = typeof args.source_span_id === "string" ? args.source_span_id.match(/^span_([a-f0-9]{16})_/)?.[1] : undefined;
        const pathSource = sourceKinds.get(`${record.session_id}:${sourcePath}`);
        const sourceId = typeof args.source_id === "string" ? args.source_id : spanSourceId ? `src_${spanSourceId}` : readSource?.sourceId ?? pathSource?.sourceId;
        const source = (sourceId ? sourceIdKinds.get(`${record.session_id}:${sourceId}`) : undefined) ?? readSource?.kind ?? pathSource?.kind ?? "unknown";
        const mode = args.read_id ? (typeof args.start_text === "string" && typeof args.end_text === "string" ? "read_id_anchors" : "read_id_range")
          : args.line_start !== undefined || args.line_end !== undefined ? "line_anchors"
            : args.source_span_id ? "source_span" : args.source_id ? "source_id_quote" : "source_path_quote";
        const question = String(args.question ?? "").trim();
        const claim = String(args.claim ?? "").trim();
        const target = [record.session_id, sourceId ?? sourcePath, question, claim].join("\u0000");
        const first = !seenEvidenceTargets.has(target);
        seenEvidenceTargets.add(target);
        const qualifiedCallId = `${record.session_id}:${callId}`;
        activeEvidenceAttempts.set(qualifiedCallId, { first, source, mode, question, claim });
        evidenceAddAttempts.calls += 1;
        const breakdown = evidenceAddAttempts.by_source[source] ??= emptyEvidenceBreakdown();
        const modeBreakdown = evidenceAddAttempts.by_input_mode[mode] ??= emptyEvidenceBreakdown();
        breakdown.calls += 1;
        modeBreakdown.calls += 1;
        if (first) {
          evidenceAddAttempts.first_attempts += 1;
          breakdown.first_attempts += 1;
          modeBreakdown.first_attempts += 1;
        } else {
          evidenceAddAttempts.retries += 1;
          evidenceAddAttempts.retry_attempts += 1;
        }
      }
    }
    if (record.event === "tool_end") {
      const name = String(data?.tool_name ?? toolStarts.get(String(data?.tool_call_id))?.name ?? "unknown");
      tools[name] ??= {
        calls: 0, errors: 0, total_duration_ms: 0, average_duration_ms: 0,
        total_duration_seconds: 0, average_duration_seconds: 0,
      };
      const duration = Number(data?.duration_ms ?? 0);
      if (Number.isFinite(duration)) tools[name].total_duration_ms += duration;
      if (state) {
        const call = state.tools.find((candidate) => candidate.id === String(data?.tool_call_id));
        if (call) {
          call.endMs = Date.parse(record.timestamp);
          call.durationMs = Number.isFinite(duration) ? duration : 0;
          call.error = data?.is_error === true;
        }
        state.toolResultChars += JSON.stringify(data?.result ?? "").length;
      }
      if (data?.is_error === true) {
        toolErrors += 1;
        tools[name].errors += 1;
        runToolErrors.set(run ?? "unknown", (runToolErrors.get(run ?? "unknown") ?? 0) + 1);
      }
      for (const produced of producedSourcePaths(name, data?.result)) {
        sourceKinds.set(`${record.session_id}:${produced.path}`, { kind: produced.kind, ...(produced.sourceId ? { sourceId: produced.sourceId } : {}) });
        if (produced.sourceId) sourceIdKinds.set(`${record.session_id}:${produced.sourceId}`, produced.kind);
      }
      for (const receipt of producedReadReceipts(name, data?.result)) {
        const pathSource = sourceKinds.get(`${record.session_id}:${receipt.path}`);
        const kind = receipt.kind ?? pathSource?.kind ?? (receipt.path.startsWith("artifacts/") ? "attachment" : undefined);
        if (!kind) continue;
        const sourceId = receipt.sourceId ?? pathSource?.sourceId;
        readKinds.set(`${record.session_id}:${receipt.readId}`, { path: receipt.path, kind, ...(sourceId ? { sourceId } : {}) });
        if (sourceId) sourceIdKinds.set(`${record.session_id}:${sourceId}`, kind);
      }
      if (name === "evidence_add") {
        const qualifiedCallId = `${record.session_id}:${String(data?.tool_call_id ?? "")}`;
        const attempt = activeEvidenceAttempts.get(qualifiedCallId);
        activeEvidenceAttempts.delete(qualifiedCallId);
        if (attempt) {
          const breakdown = evidenceAddAttempts.by_source[attempt.source] ??= emptyEvidenceBreakdown();
          const modeBreakdown = evidenceAddAttempts.by_input_mode[attempt.mode] ??= emptyEvidenceBreakdown();
          const evidenceFailed = data?.is_error === true || recordValue(data?.result)?.details?.archived === false;
          if (evidenceFailed) {
            evidenceAddAttempts.errors += 1;
            breakdown.errors += 1;
            modeBreakdown.errors += 1;
            if (attempt.first) {
              evidenceAddAttempts.first_attempt_failures += 1;
              breakdown.first_attempt_failures += 1;
              modeBreakdown.first_attempt_failures += 1;
            }
            const reason = evidenceFailureReason(data?.result);
            evidenceAddAttempts.failure_reasons[reason] = (evidenceAddAttempts.failure_reasons[reason] ?? 0) + 1;
            const failedSourceId = recordValue(recordValue(data?.result)?.details)?.sourceId;
            if (typeof failedSourceId === "string") {
              seenEvidenceTargets.add([record.session_id, failedSourceId, attempt.question, attempt.claim].join("\u0000"));
            }
          } else if (!attempt.first) {
            evidenceAddAttempts.retry_successes += 1;
          }
        }
      }
      if (name === "pubmed_read") {
        const fullText = data?.result?.details?.fullText;
        if (fullText === true) fullTextReads += 1;
        if (fullText === false) abstractOnlyReads += 1;
      }
    }
    const providerRequestIndex = String(data?.request_index ?? "unknown");
    const providerKey = `${record.session_id}:${record.run_id ?? "unknown"}:${providerRequestIndex}`;
    if (record.event === "provider_request") {
      providerRequests += 1;
      providerLifecycles.set(providerKey, { responseOk: false, firstDelta: false, completed: false });
    }
    if (record.event === "provider_response") {
      if (Number(data?.status ?? 0) >= 400) providerErrors += 1;
      if (numeric(data?.duration_seconds) > 0) providerHeadersSeconds.push(numeric(data.duration_seconds));
      const lifecycle = providerLifecycles.get(providerKey);
      if (lifecycle) lifecycle.responseOk = Number(data?.status ?? 0) >= 200 && Number(data?.status ?? 0) < 400;
    }
    if (record.event === "model_first_delta") {
      const lifecycle = providerLifecycles.get(providerKey);
      if (lifecycle) lifecycle.firstDelta = true;
    }
    if (record.event === "assistant_message") {
      const requestTiming = recordValue(data?.request_timing);
      const completedKey = `${record.session_id}:${record.run_id ?? "unknown"}:${String(requestTiming?.request_index ?? "unknown")}`;
      const lifecycle = providerLifecycles.get(completedKey);
      if (lifecycle) lifecycle.completed = true;
    }
    if (record.event === "stream_stalled") providerStreamStalls += 1;
    if (record.event === "model_first_delta" && numeric(data?.duration_seconds) > 0) firstDeltaSeconds.push(numeric(data.duration_seconds));
    if (record.event === "assistant_message" && numeric(data?.request_timing?.duration_seconds) > 0) modelCompletionSeconds.push(numeric(data.request_timing.duration_seconds));
    if (record.event === "compaction") compactions += 1;
  }

  for (const value of Object.values(tools)) {
    value.average_duration_ms = value.calls ? Math.round((value.total_duration_ms / value.calls) * 100) / 100 : 0;
    value.total_duration_seconds = Math.round(value.total_duration_ms) / 1000;
    value.average_duration_seconds = value.calls ? Math.round((value.total_duration_seconds / value.calls) * 1000) / 1000 : 0;
  }
  evidenceAddAttempts.call_failure_rate = evidenceAddAttempts.calls ? evidenceAddAttempts.errors / evidenceAddAttempts.calls : 0;
  evidenceAddAttempts.first_attempt_failure_rate = evidenceAddAttempts.first_attempts ? evidenceAddAttempts.first_attempt_failures / evidenceAddAttempts.first_attempts : 0;
  evidenceAddAttempts.retry_success_rate = evidenceAddAttempts.retry_attempts ? evidenceAddAttempts.retry_successes / evidenceAddAttempts.retry_attempts : 0;
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
  const providerIncompleteAfterHeaders = [...providerLifecycles.values()].filter((lifecycle) => lifecycle.responseOk && !lifecycle.completed).length;
  const providerIncompleteAfterFirstDelta = [...providerLifecycles.values()].filter((lifecycle) => lifecycle.responseOk && lifecycle.firstDelta && !lifecycle.completed).length;

  const phases: Record<string, PhaseAnalysis> = {};
  const runOrderedTurns = new Map<string, TurnState[]>();
  for (const state of turnStates.values()) {
    const ordered = runOrderedTurns.get(state.runId) ?? [];
    ordered.push(state);
    runOrderedTurns.set(state.runId, ordered);
  }
  for (const ordered of runOrderedTurns.values()) {
    ordered.sort((a, b) => a.index - b.index);
    const firstRetrieval = ordered.findIndex((state) => state.tools.some((tool) => /^(?:pubmed|web|guideline_mcp)_/.test(tool.name)));
    const firstEvidence = ordered.findIndex((state) => state.tools.some((tool) => tool.name.startsWith("evidence_")));
    const firstReport = ordered.findIndex((state) => state.tools.some((tool) => tool.name === "report_write"));
    for (let position = 0; position < ordered.length; position += 1) {
      const state = ordered[position]!;
      const names = state.tools.map((tool) => tool.name);
      let phase: string;
      if (names.includes("report_write")) phase = "report_drafting";
      else if (names.some((name) => name.startsWith("evidence_"))) phase = "evidence";
      else if (names.some((name) => /^(?:pubmed|web|guideline_mcp)_/.test(name))) phase = "retrieval";
      else if (firstReport >= 0 && position > firstReport && !names.length) phase = "final_response";
      else if (firstEvidence >= 0 && position >= firstEvidence && (firstReport < 0 || position < firstReport)) phase = "evidence";
      else if (firstRetrieval >= 0 && position > firstRetrieval && (firstEvidence < 0 || position < firstEvidence)) phase = "source_review";
      else if (firstRetrieval < 0 || position < firstRetrieval) phase = "setup";
      else phase = "other";
      phases[phase] ??= {
        turns: 0, elapsed_seconds: 0, model_seconds: 0, tool_wall_seconds: 0,
        tool_sum_seconds: 0, tool_calls: 0, tool_errors: 0, tool_result_chars: 0, max_context_tokens: 0,
      };
      const summary = phases[phase]!;
      const starts = state.tools.map((tool) => tool.startMs).filter(Number.isFinite);
      const ends = state.tools.map((tool) => tool.endMs).filter((value): value is number => value !== undefined && Number.isFinite(value));
      const toolWallMs = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;
      summary.turns += 1;
      summary.elapsed_seconds += state.elapsedMs / 1000;
      summary.model_seconds += state.modelMs / 1000;
      summary.tool_wall_seconds += Math.max(0, toolWallMs) / 1000;
      summary.tool_sum_seconds += state.tools.reduce((sum, tool) => sum + tool.durationMs, 0) / 1000;
      summary.tool_calls += state.tools.length;
      summary.tool_errors += state.tools.filter((tool) => tool.error).length;
      summary.tool_result_chars += state.toolResultChars;
      summary.max_context_tokens = Math.max(summary.max_context_tokens, state.contextTokens);
    }
  }
  for (const summary of Object.values(phases)) {
    summary.elapsed_seconds = Math.round(summary.elapsed_seconds * 1000) / 1000;
    summary.model_seconds = Math.round(summary.model_seconds * 1000) / 1000;
    summary.tool_wall_seconds = Math.round(summary.tool_wall_seconds * 1000) / 1000;
    summary.tool_sum_seconds = Math.round(summary.tool_sum_seconds * 1000) / 1000;
  }

  return {
    session_id: sessionId,
    user_ids: [...new Set(runUsers.values())].sort(),
    runs: runIds.length,
    user_queries: userQueries,
    system_reminders: systemReminders,
    turns: turns.size,
    assistant_messages: assistantMessages,
    thinking_chars: thinkingChars,
    response_chars: responseChars,
    tool_calls: toolCalls,
    tool_errors: toolErrors,
    duplicate_tool_actions: [...actionCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    provider_requests: providerRequests,
    provider_errors: providerErrors,
    provider_stream_stalls: providerStreamStalls,
    provider_incomplete_after_headers: providerIncompleteAfterHeaders,
    provider_incomplete_after_first_delta: providerIncompleteAfterFirstDelta,
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
    phases,
    evidence_add_attempts: evidenceAddAttempts,
    run_summaries: runIds.map((runId) => {
      const duration = milliseconds(runStarts.get(runId), runEnds.get(runId));
      const userId = runUsers.get(runId);
      return {
        run_id: runId,
        ...(userId ? { user_id: userId } : {}),
        ...(duration === undefined ? {} : { duration_ms: duration, duration_seconds: Math.round(duration) / 1000 }),
        turns: runTurns.get(runId)?.size ?? 0,
        tool_calls: runToolCalls.get(runId) ?? 0,
        tool_errors: runToolErrors.get(runId) ?? 0,
      };
    }),
  };
}
