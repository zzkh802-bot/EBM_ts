import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { AudienceMode, BackendVersion, ModeSnapshot, ResearchMode, RuntimeConfig, ThemeMode } from '../types/domain'
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
  const backendVersion = ref<BackendVersion>('v2')
  const storedRuntime = safeRead<{ provider?: string; model?: string }>('dp_xunyi_runtime_model_v1', {})
  const provider = ref(storedRuntime.provider || '')
  const model = ref(storedRuntime.model || '')
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
  watch([provider, model], () => safeWrite('dp_xunyi_runtime_model_v1', { provider: provider.value, model: model.value }))
  watch(themeMode, (value) => { safeWrite(STORAGE_KEYS.theme, value); applyTheme() })
  const setResearchMode = (value: ResearchMode) => {
    researchMode.value = value
    if (value === 'expert') deepThink.value = true
  }
  const applyRuntimeConfig = (config: RuntimeConfig) => {
    const selected = config.models.find((item) => item.available && item.provider === provider.value && item.model === model.value)
    if (selected) return
    provider.value = config.default_provider
    model.value = config.default_model
  }
  return { researchMode, audienceMode, deepThink, searchEnabled, backendVersion, provider, model, themeMode, snapshot, applyTheme, applyRuntimeConfig, setResearchMode }
})
