import { describe, expect, it, vi } from 'vitest'
import { hydrateRunReport } from '../utils/core'

describe('本轮报告回填', () => {
  it('没有本轮 report_path 时不读取会话中的上一份报告', async () => {
    const readFormalReport = vi.fn().mockResolvedValue('# 上一份报告')

    const markdown = await hydrateRunReport({
      session_id: 'session-1',
    }, readFormalReport)

    expect(markdown).toBe('')
    expect(readFormalReport).not.toHaveBeenCalled()
  })

  it('本轮只有 report_path 时才读取对应报告', async () => {
    const readFormalReport = vi.fn().mockResolvedValue('# 本轮报告')

    const markdown = await hydrateRunReport({
      session_id: 'session-1',
      report_path: 'reports/current.md',
    }, readFormalReport)

    expect(markdown).toBe('# 本轮报告')
    expect(readFormalReport).toHaveBeenCalledWith('session-1', 'reports/current.md')
  })
})
