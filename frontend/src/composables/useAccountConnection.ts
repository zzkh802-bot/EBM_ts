import { onBeforeUnmount, ref } from 'vue'
import { agentService } from '../services'
import type { AccountConnection } from '../types/domain'

export function useAccountConnection(onConnected: () => Promise<void>) {
  const accountConnection = ref<AccountConnection | null>(null)
  const connectionInput = ref('')
  let connectionTimer: number | undefined

  const stopPolling = () => {
    if (connectionTimer) window.clearInterval(connectionTimer)
    connectionTimer = undefined
  }

  const refresh = async () => {
    if (!accountConnection.value) return
    try {
      accountConnection.value = await agentService.getAccountConnection(accountConnection.value.id)
      if (accountConnection.value.status !== 'waiting') {
        stopPolling()
        if (accountConnection.value.status === 'connected') await onConnected()
      }
    } catch (error) {
      accountConnection.value = {
        ...accountConnection.value,
        status: 'failed',
        message: error instanceof Error ? error.message : '无法读取账户连接状态',
      }
      stopPolling()
    }
  }

  const connect = async (provider: string) => {
    if (provider !== 'openai-codex' && provider !== 'anthropic') return
    try {
      stopPolling()
      accountConnection.value = await agentService.startAccountConnection(provider)
      connectionInput.value = ''
      connectionTimer = window.setInterval(() => { void refresh() }, 1_500)
    } catch (error) {
      accountConnection.value = { id: '', provider, status: 'failed', message: error instanceof Error ? error.message : '无法启动账户连接' }
    }
  }

  const submitInput = async (value = connectionInput.value) => {
    if (!accountConnection.value || !value.trim()) return
    accountConnection.value = await agentService.respondAccountConnection(accountConnection.value.id, value.trim())
    connectionInput.value = ''
  }

  const cancel = async () => {
    if (!accountConnection.value?.id) return
    accountConnection.value = await agentService.cancelAccountConnection(accountConnection.value.id)
    stopPolling()
  }

  onBeforeUnmount(stopPolling)

  return { accountConnection, connectionInput, connect, submitInput, cancel, stopPolling }
}
