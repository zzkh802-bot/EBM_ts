<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useSessionsStore, useUiStore } from '../../stores'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const sessions = useSessionsStore()

const go = (path: string) => router.push(path)
const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const openSession = (id: string) => {
  sessions.activeSessionId = id
  void go('/evidence')
}
</script>

<template>
  <aside class="gemini-rail" aria-label="循医快速导航">
    <button class="rail-menu" type="button" aria-label="打开循医菜单" @click="ui.sessionDrawerOpen = true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
    <nav class="workspace-nav" aria-label="工作台一级导航">
      <button class="nav-item workspace-nav-item" :class="{ active: isActive('/evidence') }" type="button" aria-label="循证问答" @click="go('/evidence')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h7l4 4v12H7zM14 4v4h4M9.5 14.5l2 2 4-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>循证问答</span>
      </button>
      <button class="nav-item workspace-nav-item" :class="{ active: isActive('/knowledge') }" type="button" aria-label="我的知识" @click="go('/knowledge')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4h12v16H6zM9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
        <span>我的知识</span>
      </button>
      <button class="nav-item workspace-nav-item" :class="{ active: isActive('/literature') }" type="button" aria-label="文献溯源" @click="go('/literature')">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h11v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 0v16M10 8h5M10 12h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>文献溯源</span>
      </button>
      <button class="workspace-nav-item workspace-history-button" type="button" aria-label="历史问诊" @click="ui.sessionDrawerOpen = true">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7M4 4v4.7h4.7M12 8v4l2.8 1.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>历史问诊</span>
      </button>
      <section class="workspace-recent-sessions" aria-label="最近会话">
        <span class="recent-session-date">最近会话</span>
        <button v-for="session in sessions.sessions.slice(0, 3)" :key="session.id" class="recent-session-link" type="button" @click="openSession(session.id)">{{ session.title }}</button>
      </section>
    </nav>
    <button class="rail-avatar" type="button" aria-label="打开本地工作区" @click="ui.sessionDrawerOpen = true">
      <span class="avatar-initial" aria-hidden="true">循</span>
      <span class="rail-user-label">工作区</span>
      <span class="avatar-dot" aria-hidden="true"></span>
    </button>
  </aside>
</template>
