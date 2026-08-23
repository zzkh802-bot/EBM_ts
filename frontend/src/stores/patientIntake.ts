import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { PATIENT_FREE_CHAT_TURN_LIMIT, type PatientIntakeSession, type PatientMessage } from '../types/domain'
import { newId, nowIso, safeRead, safeWrite, STORAGE_KEYS, userScopedStorageKey } from '../utils/core'

const welcome = (): PatientMessage => ({
  id: newId('patient-welcome'), role: 'assistant', createdAt: nowIso(),
  content: `你好，这里可以进行最多 ${PATIENT_FREE_CHAT_TURN_LIMIT} 轮的日常健康问答。本窗口会检索可靠信息并用容易理解的方式回答；连续提问时会结合本窗口已经说过的内容。有什么想了解的？`,
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
  const sessionsKey = userScopedStorageKey(STORAGE_KEYS.patientIntake)
  const activeSessionKey = userScopedStorageKey(STORAGE_KEYS.patientIntakeActive)
  const storedSessions = safeRead<StoredPatientSession[]>(sessionsKey, [])
  const sessions = ref<PatientIntakeSession[]>(storedSessions.length ? storedSessions.map(normalizeSession) : [createSession()])
  const savedActive = safeRead(activeSessionKey, '')
  const activeSessionId = ref(sessions.value.some((session) => session.id === savedActive) ? savedActive : sessions.value[0]!.id)
  const active = computed(() => sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0]!)
  const userTurnCount = computed(() => active.value.messages.filter((message) => message.role === 'user' && !message.failed).length)
  watch([sessions, activeSessionId], () => {
    safeWrite(sessionsKey, sessions.value)
    safeWrite(activeSessionKey, activeSessionId.value)
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
  const addTo = (sessionId: string, message: PatientMessage) => {
    const session = sessions.value.find((item) => item.id === sessionId)
    if (!session) return
    session.messages.push(message)
    if (message.role === 'user' && ['新的就诊准备', '健康问答'].includes(session.title)) session.title = titleFrom(message.content)
    session.updatedAt = nowIso()
  }
  const add = (message: PatientMessage) => addTo(activeSessionId.value, message)
  const patch = (id: string, change: Partial<PatientMessage>) => {
    const message = active.value.messages.find((item) => item.id === id)
    if (message) Object.assign(message, change)
    active.value.updatedAt = nowIso()
  }
  const patchIn = (sessionId: string, id: string, change: Partial<PatientMessage>) => {
    const session = sessions.value.find((item) => item.id === sessionId)
    const message = session?.messages.find((item) => item.id === id)
    if (session && message) {
      Object.assign(message, change)
      session.updatedAt = nowIso()
    }
  }
  const markServerStarted = () => { active.value.serverStarted = true; active.value.updatedAt = nowIso() }
  const markServerStartedIn = (localSessionId: string) => {
    const session = sessions.value.find((item) => item.id === localSessionId)
    if (session) { session.serverStarted = true; session.updatedAt = nowIso() }
  }
  const setResearchSessionId = (sessionId: string) => { active.value.researchSessionId = sessionId; active.value.updatedAt = nowIso() }
  const setResearchSessionIdIn = (localSessionId: string, researchSessionId: string) => {
    const session = sessions.value.find((item) => item.id === localSessionId)
    if (session) {
      session.researchSessionId = researchSessionId
      session.updatedAt = nowIso()
    }
  }
  const clear = () => {
    const session = createSession()
    sessions.value = [session]
    activeSessionId.value = session.id
  }
  return {
    sessions, activeSessionId, active, userTurnCount,
    create, select, add, addTo, patch, patchIn, markServerStarted, markServerStartedIn,
    setResearchSessionId, setResearchSessionIdIn, clear,
  }
})
