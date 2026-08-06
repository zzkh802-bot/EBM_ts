import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '../stores'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('运行完成提醒', () => {
  it('支持多个会话并行完成提醒并按 run 去重', () => {
    const ui = useUiStore()
    ui.notifyRunCompleted({ sessionId: 'session-a', runId: 'run-a', title: '问题 A', question: '问题 A' })
    ui.notifyRunCompleted({ sessionId: 'session-a', runId: 'run-a', title: '问题 A', question: '问题 A' })
    ui.notifyRunCompleted({ sessionId: 'session-b', runId: 'run-b', title: '问题 B', question: '问题 B' })

    expect(ui.completionNotices).toHaveLength(2)
    expect(ui.completionNotices.map((notice) => notice.sessionId)).toEqual(['session-a', 'session-b'])
    ui.dismissRunNotice('session-a:run-a')
    expect(ui.completionNotices.map((notice) => notice.sessionId)).toEqual(['session-b'])
  })
})
