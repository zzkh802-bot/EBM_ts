<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './components/shell/AppShell.vue'
import PatientAppShell from './components/patient/PatientAppShell.vue'
import InternalLoginPage from './pages/InternalLoginPage.vue'
import { authService } from './services/auth'
import type { InternalUser } from './types/domain'
import { usePatientIntakeStore, useSessionsStore, useUiStore } from './stores'

const sessions = useSessionsStore()
const patientIntake = usePatientIntakeStore()
const ui = useUiStore()
const route = useRoute()
const clinicianShell = computed(() => route.meta.shell === 'clinician')
const patientShell = computed(() => route.meta.shell === 'patient')
const authReady = ref(false)
const authRequired = ref(false)
const authUser = ref<InternalUser | null>(null)

const moduleName = computed(() => {
  if (route.path.startsWith('/clinician/knowledge')) return 'knowledge'
  if (route.path.startsWith('/patient/reports')) return 'patient-reports'
  if (route.path.startsWith('/patient')) return 'patient'
  return 'evidence'
})

const hasConversation = computed(() =>
  (route.path.startsWith('/clinician/evidence')
    && sessions.active.messages.some((message) => message.role === 'user'))
  || (route.path.startsWith('/patient/intake')
    && patientIntake.active.messages.some((message) => message.role === 'user')))

const syncBody = () => {
  const body = document.body
  body.className = 'app-shell'
  body.classList.toggle('chat-mode', hasConversation.value)
  body.classList.toggle('patient-mode', patientShell.value)
  body.classList.toggle('drawer-open', ui.sessionDrawerOpen)
  body.classList.toggle('citation-open', ui.detailOpen)
  body.dataset.module = clinicianShell.value || patientShell.value ? moduleName.value : String(route.meta.shell || 'landing')
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') ui.closeTopLayer()
}
const onAuthExpired = () => { if (authRequired.value) authUser.value = null }

watch([moduleName, clinicianShell, patientShell, hasConversation, () => ui.sessionDrawerOpen, () => ui.detailOpen], syncBody, { immediate: true })

onMounted(() => {
  syncBody()
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('ebm-auth-expired', onAuthExpired)
})

onBeforeUnmount(() => {
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
    <PatientAppShell v-else-if="patientShell" />
    <RouterView v-else />
  </template>
</template>
