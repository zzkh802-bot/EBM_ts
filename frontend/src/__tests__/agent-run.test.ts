import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAgentRunStore } from '../stores'

describe('研究运行阶段', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('只接受服务端阶段，不根据耗时猜测研究状态', () => {
    vi.useFakeTimers()
    try {
      const run = useAgentRunStore()
      run.start()
      vi.advanceTimersByTime(60_000)

      expect(run.stage).toBe('planning')
      run.setStage('tooling')
      expect(run.stage).toBe('tooling')
    } finally {
      vi.useRealTimers()
    }
  })

  it('为不同研究会话保留独立的运行状态和中断控制', () => {
    const run = useAgentRunStore()
    const firstSignal = run.start('session-a')
    const secondSignal = run.start('session-b')

    run.bind('session-a')
    expect(run.busy).toBe(true)
    run.bind('session-b')
    expect(run.busy).toBe(true)

    run.stop('session-b')
    expect(secondSignal.aborted).toBe(true)
    expect(firstSignal.aborted).toBe(false)
    run.bind('session-a')
    expect(run.busy).toBe(true)
    run.finish('session-a')
    expect(run.busy).toBe(false)
  })
})
