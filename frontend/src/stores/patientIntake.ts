import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { PATIENT_FREE_CHAT_TURN_LIMIT, type PatientIntakeSession, type PatientMessage } from '../types/domain'
import { newId, nowIso, safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'

const welcome = (): PatientMessage => ({
  id: newId('patient-welcome'), role: 'assistant', createdAt: nowIso(),
  content: `你好，这里可以进行日常健康问答。你可以说说哪里不舒服、持续多久、有没有变化或让你担心的地方；我会尽量用容易理解的方式帮你理清下一步。回答不能替代医生面对面的诊疗；本次对话最多可以继续问 ${PATIENT_FREE_CHAT_TURN_LIMIT} 次。`,
})

const createSession = (): PatientIntakeSession => {
  const now = nowIso()
  return {
    id: newId('free-chat'),
    title: '健康问答',
    serverStarted: false, createdAt: now, updatedAt: now, messages: [welcome()],
  }
}

type StoredPatientSession = Partial<PatientIntakeSession> & { remoteSessionId?: string | null; mode?: unknown; profileId?: unknown }

const normalizeSession = (value: StoredPatientSession): PatientIntakeSession => {
  const stored = { ...value }
  delete stored.remoteSessionId
  delete stored.mode
  delete stored.profileId
  const fallback = createSession()
  return {
    ...fallback, ...stored,
    serverStarted: stored.serverStarted === true,
    messages: Array.isArray(stored.messages) && stored.messages.length ? stored.messages : fallback.messages,
  }
}

const titleFrom = (message: string) => {
  const text = message.replace(/\s+/g, ' ').trim()
  return text.length > 22 ? `${text.slice(0, 22)}…` : text || '健康问答'
}

export const usePatientIntakeStore = defineStore('patientIntake', () => {
  const storedSessions = safeRead<StoredPatientSession[]>(STORAGE_KEYS.patientIntake, [])
  const sessions = ref<PatientIntakeSession[]>(storedSessions.length ? storedSessions.map(normalizeSession) : [createSession()])
  const savedActive = safeRead(STORAGE_KEYS.patientIntakeActive, '')
  const activeSessionId = ref(sessions.value.some((session) => session.id === savedActive) ? savedActive : sessions.value[0]!.id)
  const active = computed(() => sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0]!)
  const userTurnCount = computed(() => active.value.messages.filter((message) => message.role === 'user' && !message.failed).length)
  watch([sessions, activeSessionId], () => {
    safeWrite(STORAGE_KEYS.patientIntake, sessions.value)
    safeWrite(STORAGE_KEYS.patientIntakeActive, activeSessionId.value)
  }, { deep: true })

  const create = () => {
    const session = createSession()
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    return session
  }
  const select = (sessionId: string) => {
    if (sessions.value.some((session) => session.id === sessionId)) activeSessionId.value = sessionId
  }
  const add = (message: PatientMessage) => {
    active.value.messages.push(message)
    if (message.role === 'user' && ['健康问答'].includes(active.value.title)) active.value.title = titleFrom(message.content)
    active.value.updatedAt = nowIso()
  }
  const patch = (id: string, change: Partial<PatientMessage>) => {
    const message = active.value.messages.find((item) => item.id === id)
    if (message) Object.assign(message, change)
    active.value.updatedAt = nowIso()
  }
  const markServerStarted = () => { active.value.serverStarted = true; active.value.updatedAt = nowIso() }
  const setResearchSessionId = (sessionId: string) => { active.value.researchSessionId = sessionId; active.value.updatedAt = nowIso() }
  return {
    sessions, activeSessionId, active, userTurnCount,
    create, select, add, patch, markServerStarted, setResearchSessionId,
  }
})