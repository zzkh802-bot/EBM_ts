import { ref } from 'vue'
import { workspaceService } from '../services'
import type { ClinicianDocument } from '../types/domain'

export function useResearchDocuments(getSessionId: () => string | null) {
  const conversationFiles = ref<ClinicianDocument[]>([])
  const conversationFilesLoading = ref(false)
  const selectedConversationFile = ref<ClinicianDocument | null>(null)
  const conversationFileContent = ref('')
  const conversationFileError = ref('')
  const conversationFileLoading = ref(false)
  let conversationReadSequence = 0
  let conversationListSequence = 0

  const readFormalReport = async (sessionId: string | undefined, preferredPath?: string) => {
    if (!sessionId) return ''
    try {
      if (preferredPath) return (await workspaceService.read(sessionId, preferredPath)).content
      const files = await workspaceService.list(sessionId)
      const report = files.files.find((file) => file.kind === 'report')
      return report ? (await workspaceService.read(sessionId, report.path)).content : ''
    } catch {
      return ''
    }
  }

  const closeConversationFile = () => {
    conversationReadSequence += 1
    selectedConversationFile.value = null
    conversationFileContent.value = ''
    conversationFileError.value = ''
  }

  const loadConversationFiles = async (sessionIdOverride?: string) => {
    const sessionId = sessionIdOverride || getSessionId()
    if (!sessionId) {
      conversationFiles.value = []
      return
    }
    const request = ++conversationListSequence
    conversationFilesLoading.value = true
    try {
      const files = (await workspaceService.list(sessionId)).files
      if (request !== conversationListSequence) return
      conversationFiles.value = files
      if (selectedConversationFile.value && !files.some((file) => file.path === selectedConversationFile.value?.path)) closeConversationFile()
    } catch {
      if (request !== conversationListSequence) return
      conversationFiles.value = []
      closeConversationFile()
    } finally {
      if (request === conversationListSequence) conversationFilesLoading.value = false
    }
  }

  const openConversationFile = async (file: ClinicianDocument) => {
    const sessionId = getSessionId()
    if (!sessionId) return
    const request = ++conversationReadSequence
    selectedConversationFile.value = file
    conversationFileContent.value = ''
    conversationFileError.value = ''
    conversationFileLoading.value = true
    try {
      // Keep the original attachment path for download/visual preview, but
      // read the server-side OCR Markdown when opening the document entry.
      const content = (await workspaceService.read(sessionId, file.preview_path || file.path)).content
      if (request === conversationReadSequence) conversationFileContent.value = content
    } catch (error) {
      if (request === conversationReadSequence) conversationFileError.value = error instanceof Error ? error.message : '无法读取该文档。'
    } finally {
      if (request === conversationReadSequence) conversationFileLoading.value = false
    }
  }

  return {
    conversationFiles,
    conversationFilesLoading,
    selectedConversationFile,
    conversationFileContent,
    conversationFileError,
    conversationFileLoading,
    readFormalReport,
    loadConversationFiles,
    openConversationFile,
    closeConversationFile,
  }
}
