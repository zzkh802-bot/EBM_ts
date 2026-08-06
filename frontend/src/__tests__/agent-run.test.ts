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
})
