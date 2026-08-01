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
    expect(intake.active.remoteSessionId).toBeNull()
    expect(intake.active.messages[0]?.content).toContain('把这次想和医生说的事情理清楚')
    intake.setRemoteSessionId('patient-pi-1')
    intake.setSummary('## 此次就诊想解决什么\n\n头痛')
    await nextTick()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.patientIntake) || '[]')[0]).toMatchObject({ remoteSessionId: 'patient-pi-1' })
    expect(localStorage.getItem(STORAGE_KEYS.sessions)).toContain('clinician-1')
  })
})
