import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStage } from '../types/domain'

export const useAgentRunStore = defineStore('agentRun', () => {
  const busy = ref(false)
  const stage = ref<AgentStage>('idle')
  const queuedGuidance = ref<string[]>([])
  let controller: AbortController | null = null
  const start = () => {
    busy.value = true; stage.value = 'planning'; controller = new AbortController()
    return controller.signal
  }
  const setStage = (value: AgentStage) => {
    stage.value = value
  }
  const finish = () => {
    busy.value = false; stage.value = 'idle'; controller = null
  }
  const stop = () => controller?.abort()
  return { busy, stage, queuedGuidance, start, setStage, finish, stop }
})
