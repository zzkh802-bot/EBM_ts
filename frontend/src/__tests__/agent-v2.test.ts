import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentService } from '../services/agent'
import type { AgentRunRequest } from '../types/domain'

const dto: AgentRunRequest = {
  question: '请回答测试问题',
  audience_mode: 'clinician',
  thinking_level: 'high',
  search_enabled: true,
}

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

afterEach(() => vi.unstubAllGlobals())

describe('循医研究服务客户端', () => {
  it('创建任务、轮询并返回当前研究响应', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ contract_version: 'xunyi-research/v1', run_id: 'run-1', status: 'queued' }, 202))
      .mockResolvedValueOnce(jsonResponse({
        contract_version: 'xunyi-research/v1', run_id: 'run-1', status: 'succeeded',
        session_id: 'pi-session', agent_answer: '循证回答摘要', report_markdown: '# 完整循证报告\n\n正文。', agent_trace: [], tools: [],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await agentService.run(dto, new AbortController().signal, { pollIntervalMs: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/ts-api/api/v1/agent-runs', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/ts-api/api/v1/agent-runs/run-1', expect.any(Object))
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ question: '请回答测试问题', thinking_level: 'high' })
    expect(result).toMatchObject({
      session_id: 'pi-session',
      agent_answer: '循证回答摘要',
      report_markdown: '# 完整循证报告\n\n正文。',
    })
  })

  it('轮询瞬时断网时沿用同一任务 ID 重试，不重复创建任务', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ contract_version: 'xunyi-research/v1', run_id: 'run-retry', status: 'queued' }, 202))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({
        contract_version: 'xunyi-research/v1', run_id: 'run-retry', status: 'succeeded',
        agent_answer: '断线恢复后的回答', agent_trace: [], tools: [],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const onNetworkRetry = vi.fn()

    const result = await agentService.run(dto, new AbortController().signal, {
      pollIntervalMs: 0,
      pollRetryBaseMs: 0,
      onNetworkRetry,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.filter(([path]) => path === '/ts-api/api/v1/agent-runs')).toHaveLength(1)
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/ts-api/api/v1/agent-runs/run-retry', expect.any(Object))
    expect(onNetworkRetry).toHaveBeenCalledWith(1)
    expect(result.agent_answer).toBe('断线恢复后的回答')
  })

  it('原样发送后端会话标识，使同一临床问题能持续追踪', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ contract_version: 'xunyi-research/v1', run_id: 'run-session', status: 'queued' }, 202))
      .mockResolvedValueOnce(jsonResponse({
        contract_version: 'xunyi-research/v1', run_id: 'run-session', status: 'succeeded',
        session_id: 'pi-session-1', agent_answer: '已沿用研究上下文。', agent_trace: [], tools: [],
      }))
    vi.stubGlobal('fetch', fetchMock)

    await agentService.run({ ...dto, session_id: 'pi-session-1' }, new AbortController().signal, { pollIntervalMs: 0 })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ session_id: 'pi-session-1' })
  })
})
