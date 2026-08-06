import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStage } from '../types/domain'

type RunState = {
  busy: boolean
  stage: AgentStage
  queuedGuidance: string[]
  controller: AbortController | null
}

const createState = (): RunState => ({ busy: false, stage: 'idle', queuedGuidance: [], controller: null })

export const useAgentRunStore = defineStore('agentRun', () => {
  // Runs are independent across research sessions. Keeping one global
  // controller here made a new session look like a follow-up to the old one.
  const activeSessionId = ref('global')
  const states = reactive<Record<string, RunState>>({ global: createState() })
  const stateFor = (sessionId = activeSessionId.value) => states[sessionId] || (states[sessionId] = createState())
  const busy = computed(() => stateFor().busy)
  const stage = computed(() => stateFor().stage)
  const queuedGuidance = computed(() => stateFor().queuedGuidance)
  const anyBusy = computed(() => Object.values(states).some((state) => state.busy))

  const bind = (sessionId: string) => {
    activeSessionId.value = sessionId || 'global'
    stateFor()
  }
  const start = (sessionId = activeSessionId.value) => {
    const state = stateFor(sessionId)
    state.busy = true; state.stage = 'planning'; state.controller = new AbortController()
    return state.controller.signal
  }
  const setStage = (sessionIdOrStage: string | AgentStage, nextStage?: AgentStage) => {
    const sessionId = nextStage ? sessionIdOrStage : activeSessionId.value
    const value = nextStage || sessionIdOrStage as AgentStage
    stateFor(sessionId).stage = value
  }
  const finish = (sessionId = activeSessionId.value) => {
    const state = stateFor(sessionId)
    state.busy = false; state.stage = 'idle'; state.controller = null
  }
  const stop = (sessionId = activeSessionId.value) => stateFor(sessionId).controller?.abort()
  const addGuidance = (sessionId: string, text: string) => stateFor(sessionId).queuedGuidance.push(text)
  const removeGuidance = (sessionId: string, index: number) => stateFor(sessionId).queuedGuidance.splice(index, 1)
  const clearGuidance = (sessionId = activeSessionId.value) => { stateFor(sessionId).queuedGuidance.splice(0) }
  return { activeSessionId, busy, anyBusy, stage, queuedGuidance, bind, start, setStage, finish, stop, addGuidance, removeGuidance, clearGuidance }
})
