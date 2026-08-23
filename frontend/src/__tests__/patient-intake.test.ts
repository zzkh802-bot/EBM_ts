import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePatientIntakeStore } from '../stores'
import { STORAGE_KEYS } from '../utils/core'
import { normalizePatientHealthAnswer } from '../utils/patientHealth'

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

  it('normalizes the patient health contract for the card renderer', () => {
    const answer = normalizePatientHealthAnswer({
      contract_version: 'xunyi-patient-health/v1',
      bottom_line: '目前可以先观察。',
      actions: ['记录变化'],
      red_flags: ['出现明显呼吸困难时尽快就医'],
      when_to_seek_care: '症状加重时就医。',
      follow_up_questions: [],
      uncertainty: '还缺少持续时间。',
      safety: { level: 'prompt_medical_review', needs_urgent_care: false },
    })
    expect(answer).toMatchObject({ bottom_line: '目前可以先观察。', safety: { level: 'prompt_medical_review' } })
    expect(normalizePatientHealthAnswer(undefined, '只有一段旧版文本')).toMatchObject({ bottom_line: '只有一段旧版文本' })
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

  it('updates the originating session when a patient switches sessions during a run', () => {
    const intake = usePatientIntakeStore()
    const origin = intake.active
    intake.add(userMessage('u-origin', '头痛时哪些情况需要尽快就医？'))
    intake.add({
      id: 'a-origin', role: 'assistant', content: '处理中', createdAt: new Date().toISOString(), pending: true,
    })
    const other = intake.create()

    intake.patchIn(origin.id, 'a-origin', {
      content: '需要结合危险信号判断。', pending: false, researchMode: 'expert',
      reportMarkdown: '# 详细循证报告', reportPath: 'reports/report.md', runId: 'run-42', queryId: 'query-42',
    })
    intake.setResearchSessionIdIn(origin.id, 'research-origin')
    intake.markServerStartedIn(origin.id)

    expect(intake.active.id).toBe(other.id)
    expect(origin.researchSessionId).toBe('research-origin')
    expect(origin.serverStarted).toBe(true)
    expect(origin.messages.find((item) => item.id === 'a-origin')).toMatchObject({
      pending: false, researchMode: 'expert', reportPath: 'reports/report.md', runId: 'run-42',
    })
  })

  it('clears patient history into one fresh local conversation', () => {
    const intake = usePatientIntakeStore()
    intake.add(userMessage('u1', '皮肤出现红疹怎么办'))
    intake.create()
    expect(intake.sessions.length).toBe(2)

    intake.clear()

    expect(intake.sessions).toHaveLength(1)
    expect(intake.active.title).toBe('健康问答')
    expect(intake.active.messages[0]?.role).toBe('assistant')
    expect(intake.userTurnCount).toBe(0)
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
