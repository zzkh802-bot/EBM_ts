import { describe, expect, it } from "vitest";
import { analyzeTrajectory, type TrajectoryRecord } from "../src/observability/analyzeTrajectory.js";

const base = { schema_version: 1 as const, session_id: "s1" };

function record(sequence: number, timestamp: string, event: string, data: unknown, runId = "run-1", turnIndex?: number): TrajectoryRecord {
  return { ...base, sequence, timestamp, event, data, run_id: runId, ...(turnIndex === undefined ? {} : { turn_index: turnIndex }) };
}

describe("trajectory analysis", () => {
  it("distinguishes stalls before and after the first model delta", () => {
    const records: TrajectoryRecord[] = [
      record(1, "2026-01-01T00:00:00.000Z", "provider_request", { request_index: 1 }),
      record(2, "2026-01-01T00:00:00.100Z", "provider_response", { request_index: 1, status: 200, duration_seconds: 0.1 }),
      record(3, "2026-01-01T00:01:30.100Z", "stream_stalled", { request_index: 1, timeout_ms: 90_000 }),
      record(4, "2026-01-01T00:01:31.000Z", "provider_request", { request_index: 2 }),
      record(5, "2026-01-01T00:01:31.100Z", "provider_response", { request_index: 2, status: 200, duration_seconds: 0.1 }),
      record(6, "2026-01-01T00:01:31.200Z", "model_first_delta", { request_index: 2, duration_seconds: 0.2 }),
    ];

    const analysis = analyzeTrajectory(records);
    expect(analysis.provider_requests).toBe(2);
    expect(analysis.provider_errors).toBe(0);
    expect(analysis.provider_stream_stalls).toBe(1);
    expect(analysis.provider_incomplete_after_headers).toBe(2);
    expect(analysis.provider_incomplete_after_first_delta).toBe(1);
  });

  it("summarizes rounds, thinking, tools, evidence timing, usage, and duplicate actions", () => {
    const records: TrajectoryRecord[] = [
      record(1, "2026-01-01T00:00:00.000Z", "run_start", { prompt: "question" }),
      record(2, "2026-01-01T00:00:01.000Z", "turn_start", {}, "run-1", 0),
      record(3, "2026-01-01T00:00:02.000Z", "tool_start", { tool_call_id: "a", tool_name: "pubmed_search", args: { query: "aspirin" } }, "run-1", 0),
      record(4, "2026-01-01T00:00:03.000Z", "tool_end", { tool_call_id: "a", tool_name: "pubmed_search", is_error: false, duration_ms: 1000 }, "run-1", 0),
      record(5, "2026-01-01T00:00:04.000Z", "tool_start", { tool_call_id: "b", tool_name: "pubmed_search", args: { query: "aspirin" } }, "run-1", 1),
      record(6, "2026-01-01T00:00:05.000Z", "tool_end", { tool_call_id: "b", tool_name: "pubmed_search", is_error: true, duration_ms: 900 }, "run-1", 1),
      record(7, "2026-01-01T00:00:06.000Z", "tool_start", { tool_call_id: "c", tool_name: "evidence_add", args: {} }, "run-1", 1),
      record(8, "2026-01-01T00:00:07.000Z", "assistant_message", {
        content: [{ type: "thinking", thinking: "compare outcomes" }, { type: "text", text: "answer" }],
        usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 0, totalTokens: 170, cost: { total: 0.01 } },
      }, "run-1", 1),
      record(9, "2026-01-01T00:00:08.000Z", "run_settled", {}),
    ];
    const analysis = analyzeTrajectory(records);
    expect(analysis).toMatchObject({
      session_id: "s1",
      runs: 1,
      turns: 2,
      thinking_chars: 16,
      response_chars: 6,
      tool_calls: 3,
      tool_errors: 1,
      duplicate_tool_actions: 1,
      total_elapsed_seconds: 8,
      first_evidence_add_delay_ms: 6000,
      first_evidence_add_delay_seconds: 6,
      first_evidence_add_turn: 2,
      tokens: { input: 100, output: 20, cache_read: 50, total: 170 },
    });
    expect(analysis.tools.pubmed_search).toMatchObject({
      calls: 2,
      errors: 1,
      total_duration_ms: 1900,
      total_duration_seconds: 1.9,
      average_duration_seconds: 0.95,
    });
    expect(analysis.run_summaries[0]).toMatchObject({ duration_seconds: 8 });
  });

  it("separates model time, concurrent tool wall time, context growth, and workflow phases", () => {
    const records: TrajectoryRecord[] = [
      record(1, "2026-01-01T00:00:00.000Z", "run_start", {}),
      record(2, "2026-01-01T00:00:00.100Z", "context_snapshot", { context_usage: { tokens: 100 } }, "run-1", 0),
      record(3, "2026-01-01T00:00:01.000Z", "assistant_message", { content: [], request_timing: { duration_ms: 900 } }, "run-1", 0),
      record(4, "2026-01-01T00:00:01.000Z", "tool_start", { tool_call_id: "a", tool_name: "pubmed_search", args: {} }, "run-1", 0),
      record(5, "2026-01-01T00:00:01.010Z", "tool_start", { tool_call_id: "b", tool_name: "web_search", args: {} }, "run-1", 0),
      record(6, "2026-01-01T00:00:03.000Z", "tool_end", { tool_call_id: "a", tool_name: "pubmed_search", duration_ms: 2000, result: { text: "a" } }, "run-1", 0),
      record(7, "2026-01-01T00:00:04.000Z", "tool_end", { tool_call_id: "b", tool_name: "web_search", duration_ms: 2990, result: { text: "bb" } }, "run-1", 0),
      record(8, "2026-01-01T00:00:04.100Z", "turn_end", { duration_ms: 4000 }, "run-1", 0),
      record(9, "2026-01-01T00:00:04.200Z", "context_snapshot", { context_usage: { tokens: 500 } }, "run-1", 1),
      record(10, "2026-01-01T00:00:05.200Z", "assistant_message", { content: [], request_timing: { duration_ms: 1000 } }, "run-1", 1),
      record(11, "2026-01-01T00:00:05.210Z", "tool_start", { tool_call_id: "c", tool_name: "evidence_add", args: {} }, "run-1", 1),
      record(12, "2026-01-01T00:00:05.220Z", "tool_end", { tool_call_id: "c", tool_name: "evidence_add", duration_ms: 10, result: {} }, "run-1", 1),
      record(13, "2026-01-01T00:00:05.230Z", "turn_end", { duration_ms: 1030 }, "run-1", 1),
      record(14, "2026-01-01T00:00:05.300Z", "run_settled", {}),
    ];
    const analysis = analyzeTrajectory(records);
    expect(analysis.phases.retrieval).toMatchObject({
      turns: 1,
      elapsed_seconds: 4,
      model_seconds: 0.9,
      tool_wall_seconds: 3,
      tool_sum_seconds: 4.99,
      tool_calls: 2,
      tool_result_chars: 25,
      max_context_tokens: 100,
    });
    expect(analysis.phases.evidence).toMatchObject({
      turns: 1,
      elapsed_seconds: 1.03,
      model_seconds: 1,
      tool_calls: 1,
      max_context_tokens: 500,
    });
  });

  it("attributes evidence first-attempt failures to retrieval source and failure reason", () => {
    const records: TrajectoryRecord[] = [
      record(1, "2026-01-01T00:00:00.000Z", "run_start", {}),
      record(2, "2026-01-01T00:00:01.000Z", "tool_end", {
        tool_call_id: "mcp", tool_name: "guideline_mcp_retrieve", is_error: false,
        result: { details: { chunkArchives: [{ path: "sources/read/mcp.md", sourceId: "src_1234567890abcdef" }] } },
      }, "run-1", 0),
      record(3, "2026-01-01T00:00:02.000Z", "tool_end", {
        tool_call_id: "pubmed", tool_name: "pubmed_search", is_error: false,
        result: { details: { abstractArchives: [{ path: "sources/read/pubmed/full.md" }] } },
      }, "run-1", 0),
      record(4, "2026-01-01T00:00:03.000Z", "tool_start", {
        tool_call_id: "ev-mcp-1", tool_name: "evidence_add",
        args: { source_path: "data/sessions/s1/sources/read/mcp.md", question: "q1", claim: "c1" },
      }, "run-1", 1),
      record(5, "2026-01-01T00:00:04.000Z", "tool_end", {
        tool_call_id: "ev-mcp-1", tool_name: "evidence_add", is_error: false,
        result: { content: [{ type: "text", text: "Evidence was not archived" }], details: { archived: false, errorCode: "quote_not_located", sourceId: "src_1234567890abcdef" } },
      }, "run-1", 1),
      record(6, "2026-01-01T00:00:05.000Z", "tool_start", {
        tool_call_id: "ev-mcp-2", tool_name: "evidence_add",
        args: { source_span_id: "span_1234567890abcdef_6o_dk_fc7e76144dc0", question: "q1", claim: "c1" },
      }, "run-1", 2),
      record(7, "2026-01-01T00:00:06.000Z", "tool_end", {
        tool_call_id: "ev-mcp-2", tool_name: "evidence_add", is_error: false, result: {},
      }, "run-1", 2),
      record(8, "2026-01-01T00:00:07.000Z", "tool_start", {
        tool_call_id: "ev-pubmed", tool_name: "evidence_add",
        args: { source_path: "sources/read/pubmed/full.md", question: "q2", claim: "c2" },
      }, "run-1", 3),
      record(9, "2026-01-01T00:00:08.000Z", "tool_end", {
        tool_call_id: "ev-pubmed", tool_name: "evidence_add", is_error: false, result: {},
      }, "run-1", 3),
      record(10, "2026-01-01T00:00:09.000Z", "tool_start", {
        tool_call_id: "ev-path", tool_name: "evidence_add",
        args: { source_path: "sources/read/missing.md", question: "q3", claim: "c3" },
      }, "run-1", 4),
      record(11, "2026-01-01T00:00:10.000Z", "tool_end", {
        tool_call_id: "ev-path", tool_name: "evidence_add", is_error: true,
        result: { content: [{ type: "text", text: "ENOENT: no such file or directory" }] },
      }, "run-1", 4),
      record(12, "2026-01-01T00:00:11.000Z", "tool_start", {
        tool_call_id: "ev-input", tool_name: "evidence_add",
        args: { source_id: "src_ffffffffffffffff", source_span_id: "span_1234567890abcdef_6o_dk_fc7e76144dc0", question: "q4", claim: "c4" },
      }, "run-1", 5),
      record(13, "2026-01-01T00:00:12.000Z", "tool_end", {
        tool_call_id: "ev-input", tool_name: "evidence_add", is_error: true,
        result: { content: [{ type: "text", text: "source_id does not match source_span_id" }] },
      }, "run-1", 5),
      record(14, "2026-01-01T00:00:13.000Z", "run_settled", {}),
    ];

    const analysis = analyzeTrajectory(records);
    expect(analysis.evidence_add_attempts).toMatchObject({
      calls: 5,
      errors: 3,
      first_attempts: 4,
      first_attempt_failures: 3,
      retry_attempts: 1,
      retry_successes: 1,
      by_source: {
        guideline_mcp_retrieve: { calls: 2, errors: 1, first_attempts: 1, first_attempt_failures: 1 },
        pubmed: { calls: 1, errors: 0, first_attempts: 1, first_attempt_failures: 0 },
        unknown: { calls: 2, errors: 2, first_attempts: 2, first_attempt_failures: 2 },
      },
      by_input_mode: {
        source_path_quote: { calls: 3, errors: 2, first_attempts: 3, first_attempt_failures: 2 },
        source_span: { calls: 2, errors: 1, first_attempts: 1, first_attempt_failures: 1 },
      },
      failure_reasons: { quote_not_located: 1, source_path: 1, input_contract: 1 },
    });
    expect(analysis.evidence_add_attempts.call_failure_rate).toBe(0.6);
    expect(analysis.evidence_add_attempts.first_attempt_failure_rate).toBe(0.75);
  });
});
