import type { AgentRequest, AgentResponse, AgentV2Request, AgentV2Response } from '../types/domain'
import { HttpError, postJson, request } from './http'

const V2_BASE = '/ts-api/api/v1/agent-runs'
const ACTIVE_V2_RUN_KEY = 'dp_xunyi_active_v2_run'
const activeStatuses = new Set(['queued', 'running', 'cancelling'])
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504])

type V2RunOptions = {
  sessionId?: string
  pollIntervalMs?: number
  pollRetryBaseMs?: number
  maxPollRetries?: number
  onStatus?: (run: AgentV2Response) => void
  onNetworkRetry?: (attempt: number) => void
}

const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const onAbort = () => {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    reject(new DOMException('请求已中断', 'AbortError'))
  }
  const timer = window.setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }, milliseconds)
  signal.addEventListener('abort', onAbort, { once: true })
})

const toV2Request = (dto: AgentRequest, sessionId?: string): AgentV2Request => ({
  question: dto.question,
  session_id: sessionId || undefined,
  research_mode: dto.research_mode,
  audience_mode: dto.audience_mode,
  deep_think: dto.deep_think,
  search_enabled: dto.search_enabled,
  max_iterations: dto.max_iterations,
  request_timeout_seconds: dto.request_timeout_seconds,
})

const rememberActiveRun = (runId: string) => {
  try {
    localStorage.setItem(ACTIVE_V2_RUN_KEY, JSON.stringify({ runId, updatedAt: new Date().toISOString() }))
  } catch {
    // The task can still run when browser storage is unavailable.
  }
}

const forgetActiveRun = (runId: string) => {
  try {
    const active = JSON.parse(localStorage.getItem(ACTIVE_V2_RUN_KEY) || '{}') as { runId?: string }
    if (active.runId === runId) localStorage.removeItem(ACTIVE_V2_RUN_KEY)
  } catch {
    // Ignore invalid or unavailable browser storage.
  }
}

const isTransientPollingError = (error: unknown, signal: AbortSignal) => {
  if (signal.aborted) return false
  if (error instanceof HttpError) return retryableStatuses.has(error.status)
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof TypeError
}

const toAgentResponse = (run: AgentV2Response): AgentResponse => ({
  ok: true,
  session_id: run.session_id,
  report_markdown: run.report_markdown,
  agent_answer: run.agent_answer || run.message,
  message: run.message,
  patient_summary: run.patient_summary,
  agent_trace: run.agent_trace || [],
  tools: run.tools || [],
  v2_run_id: run.run_id,
  v2_summary: run.summary || {},
})

export const agentService = {
  runV1: (dto: AgentRequest, signal: AbortSignal) =>
    postJson<AgentResponse>('/ebm/agent', dto, signal, (dto.request_timeout_seconds + 5) * 1000),
  cancelV2: (runId: string) =>
    postJson<AgentV2Response>(`${V2_BASE}/${encodeURIComponent(runId)}/cancel`, {}),
  async runV2(dto: AgentRequest, signal: AbortSignal, options: V2RunOptions = {}): Promise<AgentResponse> {
    if (dto.attachments.length) throw new Error('TypeScript Agent v2 首版暂不支持附件，请切换回 V1。')
    const created = await postJson<AgentV2Response>(V2_BASE, toV2Request(dto, options.sessionId), signal)
    if (!created.run_id) throw new Error('TypeScript Agent v2 未返回任务 ID。')
    const runId = created.run_id
    rememberActiveRun(runId)
    let consecutivePollFailures = 0
    try {
      while (true) {
        let run: AgentV2Response
        try {
          run = await request<AgentV2Response>(`${V2_BASE}/${encodeURIComponent(runId)}`, { signal })
          consecutivePollFailures = 0
        } catch (error) {
          const maxPollRetries = options.maxPollRetries ?? 8
          if (!isTransientPollingError(error, signal) || consecutivePollFailures >= maxPollRetries) {
            if (isTransientPollingError(error, signal)) {
              throw new Error(`网络连接连续中断，后端任务可能仍在运行（任务 ID：${runId}）。请稍后重试。`, { cause: error })
            }
            throw error
          }
          consecutivePollFailures += 1
          options.onNetworkRetry?.(consecutivePollFailures)
          const retryDelay = Math.min(
            (options.pollRetryBaseMs ?? 1_000) * 2 ** (consecutivePollFailures - 1),
            8_000,
          )
          await wait(retryDelay, signal)
          continue
        }
        options.onStatus?.(run)
        if (activeStatuses.has(run.status)) {
          await wait(options.pollIntervalMs ?? 1200, signal)
          continue
        }
        forgetActiveRun(runId)
        if (run.status === 'succeeded') return toAgentResponse(run)
        throw new Error(run.error?.message || run.message || `TypeScript Agent v2 任务状态：${run.status}`)
      }
    } catch (error) {
      if (signal.aborted) void agentService.cancelV2(runId).catch(() => undefined)
      throw error
    }
  },
}
