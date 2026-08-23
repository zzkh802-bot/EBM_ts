<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useUiStore } from '../../stores'
import SiteCredit from '../shell/SiteCredit.vue'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const askActive = () => route.path === '/patient' || isActive('/patient/intake')
</script>

<template>
  <aside class="gemini-rail patient-navigation" aria-label="患者健康版快速导航">
    <button class="rail-menu" type="button" aria-label="打开问答记录" @click="ui.sessionDrawerOpen = true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
    <nav class="workspace-nav" aria-label="患者健康版一级导航">
      <button class="nav-item workspace-nav-item" :class="{ active: askActive() }" type="button" aria-label="健康问答" @click="router.push('/patient')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h7l4 4v12H7zM14 4v4h4M9.5 14.5l2 2 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>健康问答</span>
      </button>
      <button class="nav-item workspace-nav-item" :class="{ active: isActive('/patient/reports') }" type="button" aria-label="患者报告库" @click="router.push('/patient/reports')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5h5l2 2h7v12H5zM8 11h8M8 15h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>报告库</span>
      </button>
      <button class="workspace-nav-item workspace-history-button" type="button" aria-label="问答记录" @click="ui.sessionDrawerOpen = true">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7M4 4v4.7h4.7M12 8v4l2.8 1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>问答记录</span>
      </button>
    </nav>
    <SiteCredit placement="doctor-rail" />
  </aside>
</template>
