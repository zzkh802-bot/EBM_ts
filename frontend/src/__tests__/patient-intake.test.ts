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

describe('患者就诊准备状态', () => {
  it('uses an isolated local history and does not inherit clinician research sessions', async () => {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify([{ id: 'clinician-1', messages: [] }]))
    const intake = usePatientIntakeStore()
    expect(intake.active.serverStarted).toBe(false)
    expect(intake.active.messages[0]?.content).toContain('日常健康问答')
    intake.markServerStarted()
    intake.setSummary('## 此次就诊想解决什么\n\n头痛')
    await nextTick()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.patientIntake) || '[]')[0]).toMatchObject({ serverStarted: true })
    expect(localStorage.getItem(STORAGE_KEYS.sessions)).toContain('clinician-1')
  })

  it('isolates visit sessions by profile and keeps confirmed memory with that profile', async () => {
    const intake = usePatientIntakeStore()
    const self = intake.saveProfile({ name: '我', sex: 'female', age: 31, allergies: '青霉素', pregnancy: 'no', memory: '长期服用左甲状腺素' })
    const mother = intake.saveProfile({ name: '妈妈', sex: 'female', age: 62, allergies: '', pregnancy: 'not_applicable', memory: '偏好把问题写下来' })
    intake.create('visit_preparation', self.id)
    const selfSession = intake.active.id
    intake.create('visit_preparation', mother.id)
    expect(intake.active.profileId).toBe(mother.id)
    expect(intake.activeProfile?.memory).toBe('偏好把问题写下来')
    intake.select(selfSession)
    expect(intake.activeProfile).toMatchObject({ id: self.id, allergies: '青霉素', memory: '长期服用左甲状腺素' })
    await nextTick()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.patientProfiles) || '[]')).toHaveLength(2)
  })

  it('keeps free chat profile-free and does not count failed requests against its five turns', () => {
    const intake = usePatientIntakeStore()
    intake.create('free_chat')
    intake.add({ id: 'ok', role: 'user', content: '流鼻血怎么办', createdAt: new Date().toISOString() })
    intake.add({ id: 'failed', role: 'user', content: '服务失败的问题', createdAt: new Date().toISOString(), failed: true })
    expect(intake.active.profileId).toBeNull()
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
})
