<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './components/shell/AppShell.vue'
import { usePreferencesStore, useSessionsStore, useUiStore } from './stores'

const preferences = usePreferencesStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const route = useRoute()
const media = matchMedia('(prefers-color-scheme: dark)')

const moduleName = computed(() => {
  if (route.path.startsWith('/knowledge')) return 'knowledge'
  if (route.path.startsWith('/literature')) return 'literature'
  return 'evidence'
})

const hasConversation = computed(() =>
  sessions.active.messages.some((message) => message.role === 'user'))

const resolvedTheme = computed(() => {
  if (preferences.themeMode === 'system') {
    return media.matches ? 'dark' : 'light'
  }
  return preferences.themeMode
})

const syncBody = () => {
  const body = document.body
  body.className = 'app-shell'
  body.classList.toggle('theme-dark', resolvedTheme.value === 'dark')
  body.classList.toggle('theme-light', resolvedTheme.value === 'light')
  body.classList.toggle('chat-mode', moduleName.value === 'evidence' && hasConversation.value)
  body.classList.toggle('drawer-open', ui.sessionDrawerOpen)
  body.classList.toggle('citation-open', ui.detailOpen)
  body.dataset.module = moduleName.value
  body.dataset.audience = preferences.audienceMode
  body.dataset.researchMode = preferences.researchMode
  document.documentElement.dataset.theme = resolvedTheme.value
  document.documentElement.style.colorScheme = resolvedTheme.value
}

const onThemeChange = () => syncBody()
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') ui.closeTopLayer()
}

watch([moduleName, hasConversation, resolvedTheme, () => ui.sessionDrawerOpen, () => ui.detailOpen, () => preferences.audienceMode, () => preferences.researchMode], syncBody, { immediate: true })

onMounted(() => {
  preferences.applyTheme()
  syncBody()
  media.addEventListener('change', onThemeChange)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  media.removeEventListener('change', onThemeChange)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <AppShell />
</template>
