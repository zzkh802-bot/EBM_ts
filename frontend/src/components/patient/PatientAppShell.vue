<script setup lang="ts">
import PatientAppHeader from './PatientAppHeader.vue'
import PatientDesktopRail from './PatientDesktopRail.vue'
import PatientMobileBottomNav from './PatientMobileBottomNav.vue'
import PatientSessionDrawer from './PatientSessionDrawer.vue'
import RightDetailPanel from '../shell/RightDetailPanel.vue'
import RunCompletionNotices from '../shell/RunCompletionNotices.vue'
</script>

<template>
  <div class="patient-shell">
    <PatientDesktopRail />
    <main class="mobile-app patient-mobile-app">
      <PatientAppHeader />
      <PatientSessionDrawer />
      <RightDetailPanel />
      <RunCompletionNotices />
      <RouterView />
      <PatientMobileBottomNav />
    </main>
  </div>
</template>
