import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { PATIENT_FREE_CHAT_TURN_LIMIT, type PatientConversationMode, type PatientIntakeSession, type PatientMessage, type PatientProfile } from '../types/domain'
import { newId, nowIso, safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'

const welcome = (mode: PatientConversationMode): PatientMessage => ({
  id: newId('patient-welcome'), role: 'assistant', createdAt: nowIso(),
  content: mode === 'free_chat'
    ? `你好，这里可以进行最多 ${PATIENT_FREE_CHAT_TURN_LIMIT} 轮的简单健康问答。本窗口不会读取档案，也不会记住这次内容。你想了解什么？`
    : '你好。我们可以一起把这次想和医生说的事情理清楚。你可以从“最近哪里不舒服”，或“这次最想请医生帮忙解决什么”开始。',
})

const createSession = (mode: PatientConversationMode, profileId: string | null): PatientIntakeSession => {
  const now = nowIso()
  return {
    id: newId(mode === 'free_chat' ? 'free-chat' : 'intake'),
    title: mode === 'free_chat' ? '自由问答' : '新的就诊准备',
    mode, profileId: mode === 'free_chat' ? null : profileId, thinkingEnabled: true,
    serverStarted: false, createdAt: now, updatedAt: now, messages: [welcome(mode)],
  }
}

type StoredPatientSession = Partial<PatientIntakeSession> & { remoteSessionId?: string | null }

const normalizeSession = (value: StoredPatientSession): PatientIntakeSession => {
  const stored = { ...value }
  delete stored.remoteSessionId
  const mode: PatientConversationMode = stored.mode === 'free_chat' ? 'free_chat' : 'visit_preparation'
  const fallback = createSession(mode, typeof stored.profileId === 'string' ? stored.profileId : null)
  return {
    ...fallback, ...stored, mode,
    profileId: mode === 'free_chat' ? null : typeof stored.profileId === 'string' ? stored.profileId : null,
    thinkingEnabled: stored.thinkingEnabled !== false,
    serverStarted: stored.serverStarted === true,
    messages: Array.isArray(stored.messages) && stored.messages.length ? stored.messages : fallback.messages,
  }
}

const titleFrom = (message: string) => {
  const text = message.replace(/\s+/g, ' ').trim()
  return text.length > 22 ? `${text.slice(0, 22)}…` : text || '新的就诊准备'
}

export const usePatientIntakeStore = defineStore('patientIntake', () => {
  const storedSessions = safeRead<StoredPatientSession[]>(STORAGE_KEYS.patientIntake, [])
  const sessions = ref<PatientIntakeSession[]>(storedSessions.length ? storedSessions.map(normalizeSession) : [createSession('visit_preparation', null)])
  const profiles = ref<PatientProfile[]>(safeRead<PatientProfile[]>(STORAGE_KEYS.patientProfiles, []))
  const savedActive = safeRead(STORAGE_KEYS.patientIntakeActive, '')
  const activeSessionId = ref(sessions.value.some((session) => session.id === savedActive) ? savedActive : sessions.value[0]!.id)
  const active = computed(() => sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0]!)
  const activeProfile = computed(() => profiles.value.find((profile) => profile.id === active.value.profileId) || null)
  const userTurnCount = computed(() => active.value.messages.filter((message) => message.role === 'user' && !message.failed).length)
  watch([sessions, activeSessionId], () => {
    safeWrite(STORAGE_KEYS.patientIntake, sessions.value)
    safeWrite(STORAGE_KEYS.patientIntakeActive, activeSessionId.value)
  }, { deep: true })
  watch(profiles, () => safeWrite(STORAGE_KEYS.patientProfiles, profiles.value), { deep: true })

  const create = (mode: PatientConversationMode = 'visit_preparation', profileId: string | null = null) => {
    const session = createSession(mode, profileId)
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    return session
  }
  const select = (sessionId: string) => {
    if (sessions.value.some((session) => session.id === sessionId)) activeSessionId.value = sessionId
  }
  const add = (message: PatientMessage) => {
    active.value.messages.push(message)
    if (message.role === 'user' && ['新的就诊准备', '自由问答'].includes(active.value.title)) active.value.title = titleFrom(message.content)
    active.value.updatedAt = nowIso()
  }
  const patch = (id: string, change: Partial<PatientMessage>) => {
    const message = active.value.messages.find((item) => item.id === id)
    if (message) Object.assign(message, change)
    active.value.updatedAt = nowIso()
  }
  const markServerStarted = () => { active.value.serverStarted = true; active.value.updatedAt = nowIso() }
  const setSummary = (summary: string, reportPath?: string) => {
    active.value.visitSummary = summary
    if (reportPath) active.value.reportPath = reportPath
    active.value.updatedAt = nowIso()
  }
  const setThinkingEnabled = (enabled: boolean) => { active.value.thinkingEnabled = enabled; active.value.updatedAt = nowIso() }
  const assignProfile = (profileId: string) => {
    if (active.value.mode !== 'visit_preparation' || active.value.serverStarted) return false
    if (!profiles.value.some((profile) => profile.id === profileId)) return false
    active.value.profileId = profileId
    active.value.updatedAt = nowIso()
    return true
  }
  const saveProfile = (value: Omit<PatientProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
    const now = nowIso()
    const existing = value.id ? profiles.value.find((profile) => profile.id === value.id) : undefined
    if (existing) Object.assign(existing, value, { updatedAt: now })
    else profiles.value.push({ ...value, id: newId('profile'), createdAt: now, updatedAt: now })
    return existing || profiles.value.at(-1)!
  }
  return {
    profiles, sessions, activeSessionId, active, activeProfile, userTurnCount,
    create, select, add, patch, markServerStarted, setSummary, setThinkingEnabled, assignProfile, saveProfile,
  }
})
