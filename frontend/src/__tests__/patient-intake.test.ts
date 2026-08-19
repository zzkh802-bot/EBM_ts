import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePatientIntakeStore } from '../stores'
import { STORAGE_KEYS } from '../utils/core'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

const userMessage = (id: string, content: string, failed = false) => ({
  id, role: 'user' as const, content, createdAt: new Date().toISOString(), failed,
})

describe('患者健康问答状态', () => {
  it('uses an isolated local history and does not inherit clinician research sessions', async () => {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify([{ id: 'clinician-1', messages: [] }]))
    const intake = usePatientIntakeStore()
    expect(intake.active.serverStarted).toBe(false)
    expect(intake.active.messages[0]?.content).toContain('日常健康问答')
    intake.markServerStarted()
    await nextTick()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.patientIntake) || '[]')[0]).toMatchObject({ serverStarted: true })
    expect(localStorage.getItem(STORAGE_KEYS.sessions)).toContain('clinician-1')
  })

  it('creates and switches free-chat sessions, deriving the title from the first user message', async () => {
    const intake = usePatientIntakeStore()
    const first = intake.create()
    expect(first.title).toBe('健康问答')
    intake.add(userMessage('u1', '孩子流鼻血时应该先做什么？'))
    expect(intake.active.title).toBe('孩子流鼻血时应该先做什么？')
    const second = intake.create()
    expect(intake.active.id).toBe(second.id)
    expect(intake.active.title).toBe('健康问答')
    intake.add(userMessage('u2', '为什么我最近总是睡不好'))
    intake.select(first.id)
    expect(intake.active.id).toBe(first.id)
    await nextTick()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.patientIntake) || '[]')).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.patientIntakeActive) || '""')).toBe(first.id)
  })

  it('keeps free chat profile-free and does not count failed requests against its turn limit', () => {
    const intake = usePatientIntakeStore()
    intake.add(userMessage('ok', '流鼻血怎么办'))
    intake.add(userMessage('failed', '服务失败的问题', true))
    expect(intake.userTurnCount).toBe(1)
  })

  it('patches a message and records the research session id', () => {
    const intake = usePatientIntakeStore()
    intake.add(userMessage('u1', '皮肤出现红疹怎么办'))
    const answerId = 'a1'
    intake.add({ id: answerId, role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true })
    intake.patch(answerId, { content: '先观察……', pending: false })
    intake.setResearchSessionId('research-42')
    const message = intake.active.messages.find((item) => item.id === answerId)
    expect(message).toMatchObject({ content: '先观察……', pending: false })
    expect(intake.active.researchSessionId).toBe('research-42')
  })

  it('drops legacy visit-preparation fields when reading stored sessions', () => {
    const legacy = {
      id: 'legacy-1', remoteSessionId: 'remote-9', mode: 'visit_preparation', profileId: 'profile-1',
      title: '就诊准备', serverStarted: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      messages: [{ id: 'm1', role: 'assistant' as const, content: '你好', createdAt: new Date().toISOString() }],
    }
    localStorage.setItem(STORAGE_KEYS.patientIntake, JSON.stringify([legacy]))
    const intake = usePatientIntakeStore()
    expect(intake.active.id).toBe('legacy-1')
    expect(intake.active).not.toHaveProperty('remoteSessionId')
    expect(intake.active).not.toHaveProperty('mode')
    expect(intake.active).not.toHaveProperty('profileId')
    expect(intake.active.messages[0]?.content).toBe('你好')
  })
})
