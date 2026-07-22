import { describe, expect, it } from "vitest";
import { analyzeTrajectory, type TrajectoryRecord } from "../src/observability/analyzeTrajectory.js";

const base = { schema_version: 1 as const, session_id: "s1" };

function record(sequence: number, timestamp: string, event: string, data: unknown, runId = "run-1", turnIndex?: number): TrajectoryRecord {
  return { ...base, sequence, timestamp, event, data, run_id: runId, ...(turnIndex === undefined ? {} : { turn_index: turnIndex }) };
}

describe("trajectory analysis", () => {
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
});
