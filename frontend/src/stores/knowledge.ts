import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ArchiveRun, KnowledgeItem } from '../types/domain'
import { archiveService } from '../services'
import { safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'

export const useKnowledgeStore = defineStore('knowledge', () => {
  const items = ref<KnowledgeItem[]>(safeRead(STORAGE_KEYS.knowledge, []))
  const archives = ref<ArchiveRun[]>([])
  const archiveLoading = ref(false)
  watch(items, (value) => safeWrite(STORAGE_KEYS.knowledge, value), { deep: true })
  const loadArchives = async () => {
    archiveLoading.value = true
    try { archives.value = (await archiveService.recent()).runs || [] } catch { archives.value = [] }
    finally { archiveLoading.value = false }
  }
  return { items, archives, archiveLoading, loadArchives }
})
