<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './components/shell/AppShell.vue'
import InternalLoginPage from './pages/InternalLoginPage.vue'
import { authService } from './services/auth'
import type { InternalUser } from './types/domain'
import { usePreferencesStore, useSessionsStore, useUiStore } from './stores'

const preferences = usePreferencesStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const route = useRoute()
const clinicianShell = computed(() => route.meta.shell === 'clinician')
const media = matchMedia('(prefers-color-scheme: dark)')
const authReady = ref(false)
const authRequired = ref(false)
const authUser = ref<InternalUser | null>(null)

const moduleName = computed(() => {
  if (route.path.startsWith('/clinician/knowledge')) return 'knowledge'
  return 'evidence'
})

const hasConversation = computed(() =>
  route.path.startsWith('/clinician/evidence')
  && sessions.active.messages.some((message) => message.role === 'user'))

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
  body.classList.toggle('chat-mode', clinicianShell.value && moduleName.value === 'evidence' && hasConversation.value)
  body.classList.toggle('drawer-open', ui.sessionDrawerOpen)
  body.classList.toggle('citation-open', ui.detailOpen)
  body.dataset.module = clinicianShell.value ? moduleName.value : String(route.meta.shell || 'landing')
  document.documentElement.dataset.theme = resolvedTheme.value
  document.documentElement.style.colorScheme = resolvedTheme.value
}

const onThemeChange = () => syncBody()
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') ui.closeTopLayer()
}
const onAuthExpired = () => { if (authRequired.value) authUser.value = null }

watch([moduleName, clinicianShell, hasConversation, resolvedTheme, () => ui.sessionDrawerOpen, () => ui.detailOpen], syncBody, { immediate: true })

onMounted(() => {
  preferences.applyTheme()
  syncBody()
  media.addEventListener('change', onThemeChange)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('ebm-auth-expired', onAuthExpired)
})

onBeforeUnmount(() => {
  media.removeEventListener('change', onThemeChange)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('ebm-auth-expired', onAuthExpired)
})

onMounted(async () => {
  try {
    const config = await authService.config()
    authRequired.value = config.auth_required
    if (!config.auth_required) {
      authReady.value = true
      return
    }
    try {
      authUser.value = (await authService.me()).user
    } catch {
      authUser.value = null
    }
  } catch {
    // Keep the existing local/dev mode usable if the auth endpoint is unavailable.
    authRequired.value = false
  } finally {
    authReady.value = true
  }
})

const onAuthenticated = (user: InternalUser) => {
  authUser.value = user
  authReady.value = true
}
</script>

<template>
  <InternalLoginPage v-if="authReady && authRequired && !authUser" @authenticated="onAuthenticated" />
  <template v-else-if="authReady">
    <AppShell v-if="clinicianShell" />
    <RouterView v-else />
  </template>
</template>
