import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeTrajectory, type TrajectoryRecord } from "../src/observability/analyzeTrajectory.js";

async function latestTrace(root: string): Promise<string> {
  const candidates = await traceFiles(root);
  if (!candidates[0]) throw new Error(`No trajectory.jsonl found under ${root}`);
  return candidates[0].path;
}

async function traceFiles(root: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, "trace", "trajectory.jsonl");
      try {
        candidates.push({ path: candidate, mtimeMs: (await stat(candidate)).mtimeMs });
      } catch {
        // Session has no trajectory yet.
      }
    }
  } catch {
    // Report the useful error below.
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

function markdown(analysis: ReturnType<typeof analyzeTrajectory>, tracePath: string, sessionLabel = analysis.session_id): string {
  const toolRows = Object.entries(analysis.tools)
    .sort(([, a], [, b]) => b.calls - a.calls)
    .map(([name, value]) => `| ${name} | ${value.calls} | ${value.errors} | ${value.average_duration_seconds} |`)
    .join("\n");
  const phaseRows = Object.entries(analysis.phases)
    .map(([name, value]) => `| ${name} | ${value.turns} | ${value.elapsed_seconds} | ${value.model_seconds} | ${value.tool_wall_seconds} | ${value.tool_calls} | ${value.tool_errors} | ${value.tool_result_chars} | ${value.max_context_tokens} |`)
    .join("\n");
  const evidenceRows = Object.entries(analysis.evidence_add_attempts.by_source)
    .sort(([, a], [, b]) => b.first_attempts - a.first_attempts)
    .map(([source, value]) => `| ${source} | ${value.calls} | ${value.errors} | ${value.first_attempts} | ${value.first_attempt_failures} | ${value.first_attempts ? `${Math.round(value.first_attempt_failures / value.first_attempts * 1_000) / 10}%` : "0%"} |`)
    .join("\n");
  const failureRows = Object.entries(analysis.evidence_add_attempts.failure_reasons)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => `| ${reason} | ${count} |`)
    .join("\n");
  const inputModeRows = Object.entries(analysis.evidence_add_attempts.by_input_mode)
    .sort(([, a], [, b]) => b.calls - a.calls)
    .map(([mode, value]) => `| ${mode} | ${value.calls} | ${value.errors} | ${value.first_attempts} | ${value.first_attempt_failures} | ${value.first_attempts ? `${Math.round(value.first_attempt_failures / value.first_attempts * 1_000) / 10}%` : "0%"} |`)
    .join("\n");
  return [
    "# Trajectory Analysis",
    "",
    `- Trace: ${tracePath}`,
    `- Session: ${sessionLabel}`,
    `- Users: ${analysis.user_ids.length ? analysis.user_ids.join(", ") : "unknown/pre-auth"}`,
    `- Runs: ${analysis.runs}`,
    `- Turns: ${analysis.turns}`,
    `- Total elapsed: ${analysis.total_elapsed_seconds} s`,
    `- Tool calls/errors: ${analysis.tool_calls}/${analysis.tool_errors}`,
    `- Duplicate tool actions: ${analysis.duplicate_tool_actions}`,
    `- Thinking/response characters: ${analysis.thinking_chars}/${analysis.response_chars}`,
    `- Provider requests/errors: ${analysis.provider_requests}/${analysis.provider_errors}`,
    `- Provider stream stalls: ${analysis.provider_stream_stalls}`,
    `- Incomplete after headers/after first delta: ${analysis.provider_incomplete_after_headers}/${analysis.provider_incomplete_after_first_delta}`,
    `- Full-text/abstract-only reads: ${analysis.full_text_reads}/${analysis.abstract_only_reads}`,
    `- First model delta: ${analysis.average_first_delta_seconds ?? "not observed"} s average`,
    `- Model completion: ${analysis.average_model_completion_seconds ?? "not observed"} s average`,
    `- Provider headers: ${analysis.average_provider_headers_seconds ?? "not observed"} s average`,
    `- First evidence_add: ${analysis.first_evidence_add_turn ? `turn ${analysis.first_evidence_add_turn}, ${analysis.first_evidence_add_delay_seconds} s` : "not observed"}`,
    "",
    "## Phases",
    "",
    "Tool wall time measures concurrent batches once; tool sum counts every call.",
    "",
    "| Phase | Turns | Elapsed s | Model s | Tool wall s | Calls | Errors | Result chars | Max context tokens |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    phaseRows || "| — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |",
    "",
    "## Tokens",
    "",
    "```json",
    JSON.stringify(analysis.tokens, null, 2),
    "```",
    "",
    "## Tools",
    "",
    "| Tool | Calls | Errors | Avg duration s |",
    "|---|---:|---:|---:|",
    toolRows || "| — | 0 | 0 | 0 |",
    "",
    "## Evidence add attempts",
    "",
    `- Calls/errors: ${analysis.evidence_add_attempts.calls}/${analysis.evidence_add_attempts.errors} (${Math.round(analysis.evidence_add_attempts.call_failure_rate * 1_000) / 10}%)`,
    `- First attempts/failures: ${analysis.evidence_add_attempts.first_attempts}/${analysis.evidence_add_attempts.first_attempt_failures} (${Math.round(analysis.evidence_add_attempts.first_attempt_failure_rate * 1_000) / 10}%)`,
    `- Retry attempts/successes: ${analysis.evidence_add_attempts.retry_attempts}/${analysis.evidence_add_attempts.retry_successes} (${Math.round(analysis.evidence_add_attempts.retry_success_rate * 1_000) / 10}%)`,
    "",
    "| Source | Calls | Errors | First attempts | First failures | First failure rate |",
    "|---|---:|---:|---:|---:|---:|",
    evidenceRows || "| — | 0 | 0 | 0 | 0 | 0% |",
    "",
    "| Input mode | Calls | Errors | First attempts | First failures | First failure rate |",
    "|---|---:|---:|---:|---:|---:|",
    inputModeRows || "| — | 0 | 0 | 0 | 0 | 0% |",
    "",
    "| Failure reason | Count |",
    "|---|---:|",
    failureRows || "| — | 0 |",
    "",
  ].join("\n");
}

function byUserMarkdown(records: TrajectoryRecord[]): string {
  const runsByUser = new Map<string, Set<string>>();
  const sessionsByUser = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.event !== "run_start" || !record.run_id) continue;
    const data = record.data as Record<string, unknown>;
    const userId = typeof data.user_id === "string" && data.user_id.trim() ? data.user_id.trim() : "unknown/pre-auth";
    const runs = runsByUser.get(userId) ?? new Set<string>();
    runs.add(record.run_id);
    runsByUser.set(userId, runs);
    const sessions = sessionsByUser.get(userId) ?? new Set<string>();
    sessions.add(record.session_id);
    sessionsByUser.set(userId, sessions);
  }
  const rows = [...runsByUser.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([userId, runIds]) => {
    const userSessions = sessionsByUser.get(userId) ?? new Set<string>();
    const subset = records.filter((record) => record.run_id ? runIds.has(record.run_id) : userSessions.has(record.session_id));
    const analysis = analyzeTrajectory(subset);
    return `| ${userId} | ${new Set(subset.map((record) => record.session_id)).size} | ${analysis.runs} | ${analysis.user_queries} | ${analysis.turns} | ${analysis.total_elapsed_seconds} | ${analysis.tool_calls} | ${analysis.tool_errors} | ${Math.round(analysis.evidence_add_attempts.first_attempt_failure_rate * 1_000) / 10}% |`;
  });
  return [
    "## By user",
    "",
    "| User ID | Sessions | Runs | Queries | Turns | Elapsed s | Tool calls | Tool errors | First evidence failure rate |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    rows.length ? rows.join("\n") : "| unknown/pre-auth | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0% |",
    "",
  ].join("\n");
}

const args = process.argv.slice(2);
const asMarkdown = args.includes("--markdown");
const analyzeAll = args.includes("--all");
const byUser = args.includes("--by-user");
const explicit = args.find((arg) => !arg.startsWith("--"));
const traceRoot = path.resolve("data", "sessions");
const tracePaths = analyzeAll
  ? (await traceFiles(traceRoot)).map((item) => item.path)
  : [explicit ? path.resolve(explicit) : await latestTrace(traceRoot)];
if (!tracePaths.length) throw new Error(`No trajectory.jsonl found under ${traceRoot}`);
const records = (await Promise.all(tracePaths.map(async (tracePath) => (await readFile(tracePath, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line) as TrajectoryRecord;
    } catch (error) {
      throw new Error(`Invalid JSONL at ${tracePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  })))).flat().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.sequence - right.sequence);
const analysis = analyzeTrajectory(records);
const traceLabel = analyzeAll ? `${tracePaths.length} traces under ${traceRoot}` : tracePaths[0]!;
const sessionLabel = analyzeAll ? `${new Set(records.map((record) => record.session_id)).size} sessions` : analysis.session_id;
const rendered = asMarkdown || byUser ? `${markdown(analysis, traceLabel, sessionLabel)}${byUser ? `\n${byUserMarkdown(records)}` : ""}` : `${JSON.stringify(analysis, null, 2)}\n`;
process.stdout.write(rendered);
