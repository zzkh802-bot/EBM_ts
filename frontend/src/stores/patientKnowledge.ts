import { ref } from 'vue'
import { defineStore } from 'pinia'
import { workspaceService } from '../services'
import type { WorkspaceAsset } from '../types/domain'
import { usePatientIntakeStore } from './patientIntake'

export const usePatientKnowledgeStore = defineStore('patientKnowledge', () => {
  const workspaceAssets = ref<WorkspaceAsset[]>([])
  const workspaceLoading = ref(false)

  const loadWorkspaceAssets = async () => {
    workspaceLoading.value = true
    try {
      const sessions = usePatientIntakeStore().sessions.filter((session) =>
        session.researchSessionId && session.messages.some((message) => message.role === 'user'))
      const assets = await Promise.all(sessions.map(async (session) => {
        try {
          const { files } = await workspaceService.list(session.researchSessionId!)
          return files.filter((file) => !file.path.endsWith('/toc.md')).map((file) => ({
            ...file,
            id: `${session.id}:${file.path}`,
            sessionId: session.researchSessionId!,
            sessionTitle: session.title,
            sessionUpdatedAt: session.updatedAt,
          }))
        } catch {
          return []
        }
      }))
      workspaceAssets.value = assets.flat().sort((left, right) => right.modified_at.localeCompare(left.modified_at))
    } finally {
      workspaceLoading.value = false
    }
  }

  return { workspaceAssets, workspaceLoading, loadWorkspaceAssets }
})
