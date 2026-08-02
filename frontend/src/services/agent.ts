import type { AccountConnection, AgentRunRequest, AgentRunResponse, RuntimeConfig } from '../types/domain'
import { HttpError, postJson, request } from './http'

const AGENT_RUNS_BASE = '/ts-api/api/v1/agent-runs'
const RUNTIME_CONFIG_URL = '/ts-api/api/v1/runtime-config'
const ACCOUNT_CONNECTIONS = '/ts-api/api/v1/account-connections'
const ACTIVE_RUN_KEY = 'dp_xunyi_active_research_run'
const activeStatuses = new Set(['queued', 'running', 'cancelling'])
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504])

type AgentRunOptions = {
  pollIntervalMs?: number
  pollRetryBaseMs?: number
  maxPollRetries?: number
  onStatus?: (run: AgentRunResponse) => void
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

const rememberActiveRun = (runId: string) => {
  try {
    localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify({ runId, updatedAt: new Date().toISOString() }))
  } catch {
    // The task can still run when browser storage is unavailable.
  }
}

const forgetActiveRun = (runId: string) => {
  try {
    const active = JSON.parse(localStorage.getItem(ACTIVE_RUN_KEY) || '{}') as { runId?: string }
    if (active.runId === runId) localStorage.removeItem(ACTIVE_RUN_KEY)
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

export const agentService = {
  getRuntimeConfig: () => request<RuntimeConfig>(RUNTIME_CONFIG_URL),
  startAccountConnection: (provider: AccountConnection['provider']) => postJson<AccountConnection>(ACCOUNT_CONNECTIONS, { provider }),
  getAccountConnection: (id: string) => request<AccountConnection>(`${ACCOUNT_CONNECTIONS}/${encodeURIComponent(id)}`),
  respondAccountConnection: (id: string, value: string) => postJson<AccountConnection>(`${ACCOUNT_CONNECTIONS}/${encodeURIComponent(id)}/input`, { value }),
  cancelAccountConnection: (id: string) => postJson<AccountConnection>(`${ACCOUNT_CONNECTIONS}/${encodeURIComponent(id)}/cancel`, {}),
  cancel: (runId: string) =>
    postJson<AgentRunResponse>(`${AGENT_RUNS_BASE}/${encodeURIComponent(runId)}/cancel`, {}),
  async run(dto: AgentRunRequest, signal: AbortSignal, options: AgentRunOptions = {}): Promise<AgentRunResponse> {
    const created = await postJson<AgentRunResponse>(AGENT_RUNS_BASE, dto, signal)
    if (!created.run_id) throw new Error('循证研究服务未返回任务 ID。')
    const runId = created.run_id
    rememberActiveRun(runId)
    let consecutivePollFailures = 0
    try {
      while (true) {
        let run: AgentRunResponse
        try {
          run = await request<AgentRunResponse>(`${AGENT_RUNS_BASE}/${encodeURIComponent(runId)}`, { signal })
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
        if (run.status === 'succeeded') return run
        throw new Error(run.error?.message || run.message || `研究任务状态：${run.status}`)
      }
    } catch (error) {
      if (signal.aborted) void agentService.cancel(runId).catch(() => undefined)
      throw error
    }
  },
}
