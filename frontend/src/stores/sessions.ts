import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Message, Session } from '../types/domain'
import { newId, nowIso, safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'
import { defaultModes } from './preferences'

const welcome = (): Message => ({
  id: newId('welcome'), role: 'assistant', title: '循医',
  content: '在下方输入医学问题。循医会进行证据检索、分级和回答生成，并保留可展开的运行记录。',
  trace: [], createdAt: nowIso(), ...defaultModes,
})
const createSession = (): Session => {
  const now = nowIso()
  return {
    id: newId('session'), title: '新的循证问题', researchSessionId: null,
    clinicalQuestion: '', status: 'draft', lastRunAt: null,
    createdAt: now, updatedAt: now, messages: [welcome()],
  }
}

const normalizeQuestion = (question: string) => question.replace(/\s+/g, ' ').trim()
const sessionTitle = (question: string) => question.length > 28 ? `${question.slice(0, 28)}…` : question || '新的循证问题'

export const useSessionsStore = defineStore('sessions', () => {
  const initial = safeRead<Session[]>(STORAGE_KEYS.sessions, [])
  const sessions = ref<Session[]>(initial.length ? initial : [createSession()])
  const storedActive = safeRead(STORAGE_KEYS.activeSession, '')
  const activeSessionId = ref(sessions.value.some((s) => s.id === storedActive) ? storedActive : sessions.value[0].id)
  const active = computed(() => sessions.value.find((s) => s.id === activeSessionId.value) || sessions.value[0])
  const byId = (id: string) => sessions.value.find((session) => session.id === id)
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
  const addMessageTo = (sessionId: string, message: Message) => {
    const session = byId(sessionId)
    if (!session) return
    session.messages.push(message); session.updatedAt = nowIso()
  }
  const patchMessage = (id: string, patch: Partial<Message>) => {
    const message = active.value.messages.find((item) => item.id === id)
    if (message) Object.assign(message, patch)
  }
  const patchMessageIn = (sessionId: string, id: string, patch: Partial<Message>) => {
    const session = byId(sessionId)
    const message = session?.messages.find((item) => item.id === id)
    if (message) Object.assign(message, patch)
    if (session) session.updatedAt = nowIso()
  }
  const beginResearchIn = (sessionId: string, question: string) => {
    const session = byId(sessionId)
    if (!session) return
    const clean = normalizeQuestion(question)
    if (!session.clinicalQuestion) {
      session.clinicalQuestion = clean
      session.title = sessionTitle(clean)
    }
    session.status = 'active'
    session.lastRunAt = nowIso()
    session.updatedAt = nowIso()
  }
  const completeResearchIn = (sessionId: string) => {
    const session = byId(sessionId)
    if (!session) return
    session.status = 'complete'
    session.lastRunAt = nowIso()
    session.updatedAt = nowIso()
  }
  const setResearchSessionId = (sessionId: string, researchSessionId: string) => {
    const session = byId(sessionId)
    if (session) session.researchSessionId = researchSessionId
  }
  const clear = () => {
    sessions.value = [createSession()]
    activeSessionId.value = sessions.value[0].id
  }
  return { sessions, activeSessionId, active, create, remove, clear, addMessage, addMessageTo, patchMessage, patchMessageIn, beginResearchIn, completeResearchIn, setResearchSessionId }
})
