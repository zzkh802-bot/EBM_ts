import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { PatientIntakeSession, PatientMessage } from '../types/domain'
import { newId, nowIso, safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'

const welcome = (): PatientMessage => ({
  id: newId('patient-welcome'), role: 'assistant', createdAt: nowIso(),
  content: '你好。我们可以一起把这次想和医生说的事情理清楚。你可以从“最近哪里不舒服”，或“这次最想请医生帮忙解决什么”开始。',
})

const createSession = (): PatientIntakeSession => {
  const now = nowIso()
  return { id: newId('intake'), title: '新的就诊准备', remoteSessionId: null, createdAt: now, updatedAt: now, messages: [welcome()] }
}

const titleFrom = (message: string) => {
  const text = message.replace(/\s+/g, ' ').trim()
  return text.length > 22 ? `${text.slice(0, 22)}…` : text || '新的就诊准备'
}

export const usePatientIntakeStore = defineStore('patientIntake', () => {
  const stored = safeRead<PatientIntakeSession[]>(STORAGE_KEYS.patientIntake, [])
  const sessions = ref<PatientIntakeSession[]>(stored.length ? stored : [createSession()])
  const savedActive = safeRead(STORAGE_KEYS.patientIntakeActive, '')
  const activeSessionId = ref(sessions.value.some((session) => session.id === savedActive) ? savedActive : sessions.value[0]!.id)
  const active = computed(() => sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0]!)
  watch([sessions, activeSessionId], () => {
    safeWrite(STORAGE_KEYS.patientIntake, sessions.value)
    safeWrite(STORAGE_KEYS.patientIntakeActive, activeSessionId.value)
  }, { deep: true })
  const create = () => {
    const session = createSession()
    sessions.value.unshift(session)
    activeSessionId.value = session.id
  }
  const add = (message: PatientMessage) => {
    active.value.messages.push(message)
    if (message.role === 'user' && active.value.title === '新的就诊准备') active.value.title = titleFrom(message.content)
    active.value.updatedAt = nowIso()
  }
  const patch = (id: string, change: Partial<PatientMessage>) => {
    const message = active.value.messages.find((item) => item.id === id)
    if (message) Object.assign(message, change)
    active.value.updatedAt = nowIso()
  }
  const setRemoteSessionId = (sessionId: string) => { active.value.remoteSessionId = sessionId; active.value.updatedAt = nowIso() }
  const setSummary = (summary: string) => { active.value.visitSummary = summary; active.value.updatedAt = nowIso() }
  return { sessions, activeSessionId, active, create, add, patch, setRemoteSessionId, setSummary }
})
