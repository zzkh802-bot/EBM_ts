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
});
