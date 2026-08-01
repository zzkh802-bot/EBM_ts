import { beforeEach, describe, expect, it } from 'vitest'
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
})
