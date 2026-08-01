import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePatientIntakeStore } from '../stores'
import { STORAGE_KEYS } from '../utils/core'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('患者就诊准备状态', () => {
  it('uses an isolated local history and does not inherit clinician research sessions', async () => {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify([{ id: 'clinician-1', messages: [] }]))
    const intake = usePatientIntakeStore()
    expect(intake.active.serverStarted).toBe(false)
    expect(intake.active.messages[0]?.content).toContain('把这次想和医生说的事情理清楚')
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
    intake.assignProfile(self.id)
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
})
