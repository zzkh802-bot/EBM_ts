import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { LiteratureItem } from '../types/domain'
import { literatureService } from '../services'

export const DEFAULT_LITERATURE_SEARCHES = ['EGFR', 'RA', 'SLE', 'CKD', '肝癌 PD-1']

export const useLiteratureStore = defineStore('literature', () => {
  const items = ref<LiteratureItem[]>([])
  const recent = ref<string[]>([...DEFAULT_LITERATURE_SEARCHES])
  const loading = ref(false)
  const error = ref('')
  const lastQuery = ref('')
  let sequence = 0
  let controller: AbortController | null = null
  const search = async (query: string, silent = false) => {
    const normalized = query.trim()
    if (!normalized) return
    const current = ++sequence
    controller?.abort(); controller = new AbortController()
    if (!silent) loading.value = true
    error.value = ''
    try {
      const data = await literatureService.search(normalized, controller.signal)
      if (current !== sequence) return
      items.value = data.items || data.panel?.sources?.pubmed?.items || data.result?.panel?.sources?.pubmed?.items || []
      lastQuery.value = normalized
      recent.value = [normalized, ...recent.value.filter((value) => value !== normalized)].slice(0, 8)
    } catch (reason) {
      if (current !== sequence || (reason instanceof DOMException && reason.name === 'AbortError')) return
      if (!silent) {
        error.value = reason instanceof Error ? reason.message : String(reason)
        items.value = []
      }
    } finally {
      if (current === sequence) loading.value = false
    }
  }
  const cancel = () => controller?.abort()
  return { items, recent, loading, error, lastQuery, search, cancel }
})
