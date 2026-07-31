import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { WorkspaceAsset } from '../types/domain'
import { workspaceService } from '../services'
import { useSessionsStore } from './sessions'

export const useKnowledgeStore = defineStore('knowledge', () => {
  const workspaceAssets = ref<WorkspaceAsset[]>([])
  const workspaceLoading = ref(false)
  const loadWorkspaceAssets = async () => {
    workspaceLoading.value = true
    const sessions = useSessionsStore().sessions.filter((session) => session.v2SessionId)
    const assets = await Promise.all(sessions.map(async (session) => {
      try {
        const { files } = await workspaceService.list(session.v2SessionId!)
        return files.filter((file) => !file.path.endsWith('/toc.md')).map((file) => ({
          ...file,
          id: `${session.id}:${file.path}`,
          sessionId: session.v2SessionId!,
          sessionTitle: session.title,
          sessionUpdatedAt: session.updatedAt,
        }))
      } catch {
        return []
      }
    }))
    workspaceAssets.value = assets.flat().sort((left, right) => right.modified_at.localeCompare(left.modified_at))
    workspaceLoading.value = false
  }
  return { workspaceAssets, workspaceLoading, loadWorkspaceAssets }
})
