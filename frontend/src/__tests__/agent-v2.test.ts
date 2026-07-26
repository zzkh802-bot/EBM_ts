import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentService } from '../services/agent'
import type { AgentRequest } from '../types/domain'

const dto: AgentRequest = {
  question: '请回答测试问题',
  stable_question: '测试问题',
  stable_cache: true,
  attachments: [],
  ebm_session_id: '',
  max_iterations: 5,
  request_timeout_seconds: 300,
  research_mode: 'instant',
  audience_mode: 'clinician',
  deep_think: false,
  search_enabled: true,
}

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

afterEach(() => vi.unstubAllGlobals())

describe('TypeScript Agent v2 client', () => {
  it('创建任务、轮询并映射为现有 AgentResponse', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ contract_version: 'dp-xunyi-agent/v2', run_id: 'run-1', status: 'queued' }, 202))
      .mockResolvedValueOnce(jsonResponse({
        contract_version: 'dp-xunyi-agent/v2', run_id: 'run-1', status: 'succeeded',
        session_id: 'pi-session', agent_answer: '循证回答摘要', report_markdown: '# 完整循证报告\n\n正文。', agent_trace: [], tools: [],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await agentService.runV2(dto, new AbortController().signal, { pollIntervalMs: 0 })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/ts-api/api/v1/agent-runs', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/ts-api/api/v1/agent-runs/run-1', expect.any(Object))
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ request_timeout_seconds: 300 })
    expect(result).toMatchObject({
      ok: true,
      session_id: 'pi-session',
      agent_answer: '循证回答摘要',
      report_markdown: '# 完整循证报告\n\n正文。',
    })
  })

  it('轮询瞬时断网时沿用同一任务 ID 重试，不重复创建任务', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ contract_version: 'dp-xunyi-agent/v2', run_id: 'run-retry', status: 'queued' }, 202))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({
        contract_version: 'dp-xunyi-agent/v2', run_id: 'run-retry', status: 'succeeded',
        agent_answer: '断线恢复后的回答', agent_trace: [], tools: [],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const onNetworkRetry = vi.fn()

    const result = await agentService.runV2(dto, new AbortController().signal, {
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

  it('拒绝把附件静默发送给 V2', async () => {
    await expect(agentService.runV2({
      ...dto,
      attachments: [{ name: 'case.pdf', size: 1, type: 'application/pdf', content_base64: 'data:application/pdf;base64,QQ==' }],
    }, new AbortController().signal)).rejects.toThrow('暂不支持附件')
  })
})
