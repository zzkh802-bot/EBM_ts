import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AgentStage } from '../types/domain'

export const useAgentRunStore = defineStore('agentRun', () => {
  const busy = ref(false)
  const stage = ref<AgentStage>('idle')
  const queuedGuidance = ref<string[]>([])
  let controller: AbortController | null = null
  let timer: number | null = null
  const start = () => {
    busy.value = true; stage.value = 'planning'; controller = new AbortController()
    const started = Date.now()
    timer = window.setInterval(() => {
      const elapsed = Date.now() - started
      stage.value = elapsed > 45_000 ? 'network_wait' : elapsed > 16_000 ? 'generating' : elapsed > 7_000 ? 'tooling' : elapsed > 1_800 ? 'retrieving' : 'planning'
    }, 1_200)
    return controller.signal
  }
  const finish = () => {
    busy.value = false; stage.value = 'idle'; controller = null
    if (timer) window.clearInterval(timer)
    timer = null
  }
  const stop = () => controller?.abort()
  return { busy, stage, queuedGuidance, start, finish, stop }
})
