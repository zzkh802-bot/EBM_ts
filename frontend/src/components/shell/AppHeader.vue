<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { healthService } from '../../services'
import { usePreferencesStore, useSessionsStore, useUiStore } from '../../stores'

const preferences = usePreferencesStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const serviceStatus = ref('检测中')

const chooseTheme = (value: 'light' | 'dark' | 'system') => {
  preferences.themeMode = value
  ui.themeMenuOpen = false
}

onMounted(async () => {
  try {
    const result = await healthService.check()
    serviceStatus.value = result.ok === false ? '离线' : '在线'
  } catch {
    serviceStatus.value = '离线'
  }
})
</script>

<template>
  <div class="app-top">
    <div class="app-brand">
      <button class="icon-button" type="button" aria-label="打开用户与历史列表" @click="ui.sessionDrawerOpen = true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
      <svg class="dp-logo-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect class="dp-logo-sheet" x="14" y="8" width="36" height="48" rx="8" /><path class="dp-logo-check" d="M22 22l7 7 14-15" /><path class="dp-logo-pulse" d="M19 38h8l4-10 6 19 5-12h7" /><circle class="dp-logo-node" cx="50" cy="48" r="5" /></svg>
      <span>DP循医</span>
    </div>
    <div class="top-actions">
      <span class="hidden-control">{{ serviceStatus }}</span>
      <div class="theme-switcher">
        <button class="icon-button theme-toggle" type="button" aria-label="调整显示模式" :aria-expanded="ui.themeMenuOpen" @click="ui.themeMenuOpen = !ui.themeMenuOpen">
          <svg width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v2.4M12 18.6V21M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M3 12h2.4M18.6 12H21M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        </button>
        <div v-show="ui.themeMenuOpen" class="theme-menu" role="menu" aria-label="显示模式">
          <button class="theme-option" type="button" role="menuitemradio" :aria-checked="preferences.themeMode === 'light'" @click="chooseTheme('light')">
            <span>日间模式</span><span class="theme-check">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" :aria-checked="preferences.themeMode === 'dark'" @click="chooseTheme('dark')">
            <span>月间模式</span><span class="theme-check">✓</span>
          </button>
          <button class="theme-option" type="button" role="menuitemradio" :aria-checked="preferences.themeMode === 'system'" @click="chooseTheme('system')">
            <span>随系统</span><span class="theme-check">✓</span>
          </button>
        </div>
      </div>
      <button class="icon-button" type="button" aria-label="新建对话" @click="sessions.create()">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7v6m-3-3h6M7.5 19.5 4 21l1.2-3.7A8 8 0 1 1 7.5 19.5Z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button id="shareBtn" class="icon-button" type="button" aria-label="分享给好友">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H7a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  </div>
</template>
