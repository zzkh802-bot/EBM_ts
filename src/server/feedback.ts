import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { queryMetadataExists } from "../observability/queryMetadata.js";

export const FEEDBACK_RUBRICS = [
  "requirement_understanding",
  "clinical_interpretation_accuracy",
  "subquestion_decomposition",
  "evidence_support",
  "report_trustworthiness",
  "report_completeness",
  "report_clarity",
  "ebm_standard_compliance",
  "time_worth",
] as const;
export type FeedbackRubric = typeof FEEDBACK_RUBRICS[number];
export const FEEDBACK_PREFERRED_TOOLS = ["xunyi", "doubao", "no_preference", "not_used"] as const;
export type FeedbackPreferredTool = typeof FEEDBACK_PREFERRED_TOOLS[number];

export type FeedbackInput = {
  runId: string;
  queryId: string;
  rubrics: Partial<Record<FeedbackRubric, number>>;
  preferredTool?: FeedbackPreferredTool;
  comment?: string;
};

export class FeedbackValidationError extends Error {}

export async function writeFeedback(_rootDir: string, sessionDir: string, userId: string, sessionId: string, input: FeedbackInput): Promise<{ path: string; createdAt: string }> {
  const rubrics = validateRubrics(input.rubrics);
  if (!input.runId || !/^[0-9a-f-]{20,64}$/i.test(input.runId)) throw new FeedbackValidationError("run_id 无效。 ");
  if (!input.queryId || !/^[0-9a-f-]{20,64}$/i.test(input.queryId)) throw new FeedbackValidationError("query_id 无效。 ");
  if (!(await queryMetadataExists(sessionDir, sessionId, input.queryId))) throw new FeedbackValidationError("query_id 不属于当前研究会话。 ");
  const comment = input.comment?.trim() || undefined;
  if (comment && comment.length > 4_000) throw new FeedbackValidationError("反馈文字不能超过 4000 个字符。 ");
  const createdAt = new Date().toISOString();
  const record = {
    schema_version: 1,
    created_at: createdAt,
    user_id: userId,
    session_id: sessionId,
    run_id: input.runId,
    query_id: input.queryId,
    rubrics,
    ...(input.preferredTool ? { preferred_tool: input.preferredTool } : {}),
    ...(comment ? { comment } : {}),
  };
  const feedbackDir = path.join(sessionDir, "feedback");
  await mkdir(feedbackDir, { recursive: true, mode: 0o700 });
  const feedbackPath = path.join(feedbackDir, "feedback.jsonl");
  await appendFile(feedbackPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return { path: path.posix.join("feedback", "feedback.jsonl"), createdAt };
}

export function validatePreferredTool(value: unknown): FeedbackPreferredTool | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(FEEDBACK_PREFERRED_TOOLS as readonly string[]).includes(value)) {
    throw new FeedbackValidationError("preferred_tool 必须是循医、豆包、无偏好或未使用过豆包之一。 ");
  }
  return value as FeedbackPreferredTool;
}

function validateRubrics(value: unknown): Partial<Record<FeedbackRubric, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeedbackValidationError("rubrics 必须是对象。 ");
  const output: Partial<Record<FeedbackRubric, number>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!(FEEDBACK_RUBRICS as readonly string[]).includes(key)) throw new FeedbackValidationError(`未知反馈指标：${key}`);
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 5) throw new FeedbackValidationError(`反馈指标 ${key} 必须是 1 到 5 的整数。`);
    output[key as FeedbackRubric] = raw;
  }
  if (!Object.keys(output).length) throw new FeedbackValidationError("至少需要填写一个反馈指标。 ");
  return output;
}
