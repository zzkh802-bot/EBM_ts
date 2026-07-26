<script setup lang="ts">
import DesktopRail from './DesktopRail.vue'
import AppHeader from './AppHeader.vue'
import MobileBottomNav from './MobileBottomNav.vue'
import SessionDrawer from './SessionDrawer.vue'
import RightDetailPanel from './RightDetailPanel.vue'
</script>

<template>
  <DesktopRail />
  <main class="mobile-app">
    <AppHeader />
    <SessionDrawer />
    <RightDetailPanel />
    <RouterView />
    <MobileBottomNav />
  </main>
</template>
