import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeTrajectory, type TrajectoryRecord } from "../src/observability/analyzeTrajectory.js";

async function latestTrace(root: string): Promise<string> {
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
  if (!candidates[0]) throw new Error(`No trajectory.jsonl found under ${root}`);
  return candidates[0].path;
}

function markdown(analysis: ReturnType<typeof analyzeTrajectory>, tracePath: string): string {
  const toolRows = Object.entries(analysis.tools)
    .sort(([, a], [, b]) => b.calls - a.calls)
    .map(([name, value]) => `| ${name} | ${value.calls} | ${value.errors} | ${value.average_duration_seconds} |`)
    .join("\n");
  return [
    "# Trajectory Analysis",
    "",
    `- Trace: ${tracePath}`,
    `- Session: ${analysis.session_id}`,
    `- Runs: ${analysis.runs}`,
    `- Turns: ${analysis.turns}`,
    `- Total elapsed: ${analysis.total_elapsed_seconds} s`,
    `- Tool calls/errors: ${analysis.tool_calls}/${analysis.tool_errors}`,
    `- Duplicate tool actions: ${analysis.duplicate_tool_actions}`,
    `- Thinking/response characters: ${analysis.thinking_chars}/${analysis.response_chars}`,
    `- Provider requests/errors: ${analysis.provider_requests}/${analysis.provider_errors}`,
    `- Full-text/abstract-only reads: ${analysis.full_text_reads}/${analysis.abstract_only_reads}`,
    `- First model delta: ${analysis.average_first_delta_seconds ?? "not observed"} s average`,
    `- Model completion: ${analysis.average_model_completion_seconds ?? "not observed"} s average`,
    `- Provider headers: ${analysis.average_provider_headers_seconds ?? "not observed"} s average`,
    `- First evidence_add: ${analysis.first_evidence_add_turn ? `turn ${analysis.first_evidence_add_turn}, ${analysis.first_evidence_add_delay_seconds} s` : "not observed"}`,
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
  ].join("\n");
}

const args = process.argv.slice(2);
const asMarkdown = args.includes("--markdown");
const explicit = args.find((arg) => !arg.startsWith("--"));
const tracePath = explicit
  ? path.resolve(explicit)
  : await latestTrace(path.resolve("data", "sessions"));
const records = (await readFile(tracePath, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line) as TrajectoryRecord;
    } catch (error) {
      throw new Error(`Invalid JSONL at ${tracePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
const analysis = analyzeTrajectory(records);
process.stdout.write(asMarkdown ? markdown(analysis, tracePath) : `${JSON.stringify(analysis, null, 2)}\n`);
