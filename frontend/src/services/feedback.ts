import type { FeedbackPreferredTool, FeedbackRubrics } from '../types/domain'
import { postJson } from './http'

export const feedbackService = {
  submit: (sessionId: string, runId: string, rubrics: FeedbackRubrics, preferredTool?: FeedbackPreferredTool, comment?: string) =>
    postJson<{ ok: true; session_id: string; path: string }>(
      `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/feedback`,
      { run_id: runId, query_id: runId, rubrics, ...(preferredTool ? { preferred_tool: preferredTool } : {}), ...(comment?.trim() ? { comment: comment.trim() } : {}) },
    ),
}
