import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Message, Session } from '../types/domain'
import { migrateSessions, newId, nowIso, readLegacyString, safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'
import { defaultModes } from './preferences'

const welcome = (): Message => ({
  id: newId('welcome'), role: 'assistant', title: '循医',
  content: '在下方输入医学问题。循医会进行证据检索、分级和回答生成，并保留可展开的运行记录。',
  trace: [], createdAt: nowIso(), ...defaultModes,
})
const createSession = (): Session => {
  const now = nowIso()
  return { id: newId('session'), title: '新的循证对话', ebmSessionId: null, v2SessionId: null, createdAt: now, updatedAt: now, messages: [welcome()] }
}

export const useSessionsStore = defineStore('sessions', () => {
  const legacy = readLegacyString(STORAGE_KEYS.legacySession)
  const initial = migrateSessions(safeRead(STORAGE_KEYS.sessions, []), legacy)
  const sessions = ref<Session[]>(initial.length ? initial : [createSession()])
  const storedActive = readLegacyString(STORAGE_KEYS.activeSession)
  const activeSessionId = ref(sessions.value.some((s) => s.id === storedActive) ? storedActive : sessions.value[0].id)
  const active = computed(() => sessions.value.find((s) => s.id === activeSessionId.value) || sessions.value[0])
  watch([sessions, activeSessionId], () => {
    safeWrite(STORAGE_KEYS.sessions, sessions.value)
    safeWrite(STORAGE_KEYS.activeSession, activeSessionId.value)
  }, { deep: true })
  const create = () => {
    const session = createSession()
    sessions.value.unshift(session); activeSessionId.value = session.id
  }
  const remove = (id: string) => {
    sessions.value = sessions.value.filter((session) => session.id !== id)
    if (!sessions.value.length) sessions.value = [createSession()]
    if (!sessions.value.some((session) => session.id === activeSessionId.value)) activeSessionId.value = sessions.value[0].id
  }
  const addMessage = (message: Message) => { active.value.messages.push(message); active.value.updatedAt = nowIso() }
  const patchMessage = (id: string, patch: Partial<Message>) => {
    const message = active.value.messages.find((item) => item.id === id)
    if (message) Object.assign(message, patch)
  }
  const titleFromQuestion = (question: string) => {
    if (active.value.title !== '新的循证对话') return
    const clean = question.replace(/\s+/g, ' ').trim()
    active.value.title = clean.length > 24 ? `${clean.slice(0, 24)}…` : clean || '附件分析'
  }
  const clear = () => {
    sessions.value = [createSession()]
    activeSessionId.value = sessions.value[0].id
  }
  return { sessions, activeSessionId, active, create, remove, clear, addMessage, patchMessage, titleFromQuestion }
})
