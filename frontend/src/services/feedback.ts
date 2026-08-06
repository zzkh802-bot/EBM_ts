import type { FeedbackRubrics } from '../types/domain'
import { postJson } from './http'

export const feedbackService = {
  submit: (sessionId: string, runId: string, rubrics: FeedbackRubrics, comment?: string) =>
    postJson<{ ok: true; session_id: string; path: string }>(
      `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/feedback`,
      { run_id: runId, query_id: runId, rubrics, ...(comment?.trim() ? { comment: comment.trim() } : {}) },
    ),
}
