<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useUiStore } from '../../stores'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const go = (path: string) => router.push(path)
const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const evidenceActive = () => route.path === '/clinician' || isActive('/clinician/evidence')
</script>

<template>
  <aside class="gemini-rail" aria-label="循医快速导航">
    <button class="rail-menu" type="button" aria-label="打开循医菜单" @click="ui.sessionDrawerOpen = true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
    <nav class="workspace-nav" aria-label="工作台一级导航">
      <button class="nav-item workspace-nav-item" :class="{ active: evidenceActive() }" type="button" aria-label="循证研究" @click="go('/clinician')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h7l4 4v12H7zM14 4v4h4M9.5 14.5l2 2 4-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>研究</span>
      </button>
      <button class="nav-item workspace-nav-item" :class="{ active: isActive('/clinician/knowledge') }" type="button" aria-label="研究报告库" @click="go('/clinician/knowledge')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5h5l2 2h7v12H5zM8 11h8M8 15h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>报告库</span>
      </button>
      <button class="workspace-nav-item workspace-history-button" type="button" aria-label="研究记录" @click="ui.sessionDrawerOpen = true">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7M4 4v4.7h4.7M12 8v4l2.8 1.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>研究记录</span>
      </button>
    </nav>
  </aside>
</template>
