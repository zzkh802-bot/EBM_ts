import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionsStore } from '../stores'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('临床问题会话', () => {
  it('为每个临床问题建立独立、可长期追踪的会话状态', () => {
    const sessions = useSessionsStore()
    const firstSessionId = sessions.activeSessionId

    sessions.beginResearchIn(firstSessionId, '房颤患者卒中二级预防的抗凝策略如何选择？')
    sessions.setResearchSessionId(firstSessionId, 'pi-session-a')
    sessions.completeResearchIn(firstSessionId)

    sessions.create()
    const secondSessionId = sessions.activeSessionId
    sessions.beginResearchIn(secondSessionId, '慢性肾病合并高钾血症如何长期管理？')
    sessions.setResearchSessionId(secondSessionId, 'pi-session-b')

    expect(sessions.sessions).toHaveLength(2)
    expect(sessions.sessions.find((session) => session.id === firstSessionId)).toMatchObject({
      clinicalQuestion: '房颤患者卒中二级预防的抗凝策略如何选择？', researchSessionId: 'pi-session-a', status: 'complete',
    })
    expect(sessions.active).toMatchObject({
      clinicalQuestion: '慢性肾病合并高钾血症如何长期管理？', researchSessionId: 'pi-session-b', status: 'active',
    })
  })

  it('修改消息阅读状态时同步更新会话时间', () => {
    const sessions = useSessionsStore()
    const before = sessions.active.updatedAt
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse(before) + 1_000))
    try {
      sessions.patchMessage(sessions.active.messages[0]!.id, { showMarkdown: true })

      expect(sessions.active.messages[0]!.showMarkdown).toBe(true)
      expect(sessions.active.updatedAt).not.toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('忽略不存在的消息而不改动会话时间', () => {
    const sessions = useSessionsStore()
    const before = sessions.active.updatedAt

    sessions.patchMessage('missing-message', { showMarkdown: true })
    sessions.patchMessageIn(sessions.active.id, 'missing-message', { showMarkdown: true })

    expect(sessions.active.updatedAt).toBe(before)
  })
})
