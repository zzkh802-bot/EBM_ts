import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Reference } from '../utils/report'

export type DetailKind = 'citation' | 'archive' | 'generic'

export const useUiStore = defineStore('ui', () => {
  const sessionDrawerOpen = ref(false)
  const themeMenuOpen = ref(false)
  const detailOpen = ref(false)
  const detailTitle = ref('')
  const detailKind = ref<DetailKind>('generic')
  const detailPayload = ref<unknown>(null)
  const openDetail = (title: string, payload: unknown, kind: DetailKind = 'generic') => {
    detailTitle.value = title; detailPayload.value = payload; detailKind.value = kind; detailOpen.value = true
  }
  const openCitation = (reference: Reference) => openDetail(`引用 [${reference.number}]`, reference, 'citation')
  const closeTopLayer = () => {
    if (detailOpen.value) detailOpen.value = false
    else if (sessionDrawerOpen.value) sessionDrawerOpen.value = false
    else if (themeMenuOpen.value) themeMenuOpen.value = false
  }
  return { sessionDrawerOpen, themeMenuOpen, detailOpen, detailTitle, detailKind, detailPayload, openDetail, openCitation, closeTopLayer }
})
