import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Reference } from '../utils/report'

export type DetailKind = 'citation'
export type CitationContext = { sessionId: string; reportPath: string }
export type RunCompletionNotice = {
  id: string
  sessionId: string
  runId?: string
  title: string
  question: string
}

export const useUiStore = defineStore('ui', () => {
  const sessionDrawerOpen = ref(false)
  const detailOpen = ref(false)
  const detailTitle = ref('')
  const detailKind = ref<DetailKind>('citation')
  const detailPayload = ref<unknown>(null)
  const completionNotices = ref<RunCompletionNotice[]>([])
  const openDetail = (title: string, payload: unknown, kind: DetailKind) => {
    detailTitle.value = title; detailPayload.value = payload; detailKind.value = kind; detailOpen.value = true
  }
  const openCitation = (reference: Reference, context?: CitationContext) => openDetail(
    `引用 [${reference.number}]`,
    { ...reference, ...(context || {}) },
    'citation',
  )
  const notifyRunCompleted = (notice: Omit<RunCompletionNotice, 'id'>) => {
    const id = notice.runId ? `${notice.sessionId}:${notice.runId}` : notice.sessionId
    if (completionNotices.value.some((item) => item.id === id)) return
    completionNotices.value.push({ ...notice, id })
  }
  const dismissRunNotice = (id: string) => {
    completionNotices.value = completionNotices.value.filter((notice) => notice.id !== id)
  }
  const closeTopLayer = () => {
    if (detailOpen.value) detailOpen.value = false
    else if (sessionDrawerOpen.value) sessionDrawerOpen.value = false
  }
  return {
    sessionDrawerOpen, detailOpen, detailTitle, detailKind, detailPayload,
    completionNotices, openDetail, openCitation, notifyRunCompleted, dismissRunNotice, closeTopLayer,
  }
})
