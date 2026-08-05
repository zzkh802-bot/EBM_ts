import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ModeSnapshot, RuntimeConfig, ThemeMode, ThinkingLevel } from '../types/domain'
import { safeRead, safeWrite, STORAGE_KEYS } from '../utils/core'

export const defaultModes: ModeSnapshot = {
  audienceMode: 'clinician', thinkingLevel: 'low', searchEnabled: true,
}

const thinkingLevels: ThinkingLevel[] = ['off', 'low', 'medium', 'high']

export const usePreferencesStore = defineStore('preferences', () => {
  const stored = safeRead<Partial<ModeSnapshot>>(STORAGE_KEYS.modes, {})
  const thinkingLevel = ref<ThinkingLevel>(thinkingLevels.includes(stored.thinkingLevel as ThinkingLevel)
    ? stored.thinkingLevel as ThinkingLevel
    : 'low')
  // Evidence retrieval is part of the clinician workflow and is no longer a
  // user-toggleable mode. Keep the field for wire/storage compatibility.
  const searchEnabled = ref(true)
  const storedRuntime = safeRead<{ provider?: string; model?: string }>(STORAGE_KEYS.runtime, {})
  const provider = ref(storedRuntime.provider || '')
  const model = ref(storedRuntime.model || '')
  const rawTheme = safeRead<ThemeMode>(STORAGE_KEYS.theme, 'system')
  const themeMode = ref<ThemeMode>(['light', 'dark', 'system'].includes(rawTheme) ? rawTheme as ThemeMode : 'system')
  const snapshot = computed<ModeSnapshot>(() => ({
    // The only shipped workspace is for clinicians. Keep the API field so a future
    // patient-facing surface can opt into its own policy without reviving a UI toggle.
    audienceMode: 'clinician', thinkingLevel: thinkingLevel.value, searchEnabled: searchEnabled.value,
  }))
  const applyTheme = () => {
    const dark = themeMode.value === 'dark' ||
      (themeMode.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }
  watch(snapshot, (value) => safeWrite(STORAGE_KEYS.modes, value), { deep: true })
  watch([provider, model], () => safeWrite(STORAGE_KEYS.runtime, { provider: provider.value, model: model.value }))
  watch(themeMode, (value) => { safeWrite(STORAGE_KEYS.theme, value); applyTheme() })
  const applyRuntimeConfig = (config: RuntimeConfig) => {
    const selected = config.models.find((item) => item.available && item.provider === provider.value && item.model === model.value)
    if (selected) return
    provider.value = config.default_provider
    model.value = config.default_model
  }
  return { thinkingLevel, searchEnabled, provider, model, themeMode, snapshot, applyTheme, applyRuntimeConfig }
})
