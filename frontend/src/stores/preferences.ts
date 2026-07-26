import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { AudienceMode, BackendVersion, ModeSnapshot, ResearchMode, ThemeMode } from '../types/domain'
import { readLegacyString, safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'

export const defaultModes: ModeSnapshot = {
  researchMode: 'instant', audienceMode: 'clinician', deepThink: false, searchEnabled: true,
}

export const usePreferencesStore = defineStore('preferences', () => {
  const stored = safeRead<Partial<ModeSnapshot>>(STORAGE_KEYS.modes, {})
  const researchMode = ref<ResearchMode>(stored.researchMode === 'expert' ? 'expert' : 'instant')
  const audienceMode = ref<AudienceMode>(stored.audienceMode === 'public' ? 'public' : 'clinician')
  const deepThink = ref(typeof stored.deepThink === 'boolean' ? stored.deepThink : false)
  const searchEnabled = ref(typeof stored.searchEnabled === 'boolean' ? stored.searchEnabled : true)
  const backendVersion = ref<BackendVersion>('v1')
  const rawTheme = readLegacyString(STORAGE_KEYS.theme, 'system')
  const themeMode = ref<ThemeMode>(['light', 'dark', 'system'].includes(rawTheme) ? rawTheme as ThemeMode : 'system')
  const snapshot = computed<ModeSnapshot>(() => ({
    researchMode: researchMode.value, audienceMode: audienceMode.value,
    deepThink: deepThink.value, searchEnabled: searchEnabled.value,
  }))
  const applyTheme = () => {
    const dark = themeMode.value === 'dark' ||
      (themeMode.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  watch(snapshot, (value) => safeWrite(STORAGE_KEYS.modes, value), { deep: true })
  watch(themeMode, (value) => { safeWrite(STORAGE_KEYS.theme, value); applyTheme() })
  const setResearchMode = (value: ResearchMode) => {
    researchMode.value = value
  }
  return { researchMode, audienceMode, deepThink, searchEnabled, backendVersion, themeMode, snapshot, applyTheme, setResearchMode }
})
