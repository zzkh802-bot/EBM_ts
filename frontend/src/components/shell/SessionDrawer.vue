<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionsStore, useUiStore } from '../../stores'

const sessions = useSessionsStore()
const ui = useUiStore()
const router = useRouter()
const query = ref('')

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return sessions.sessions
  return sessions.sessions.filter((session) =>
    session.title.toLowerCase().includes(text)
    || session.messages.some((message) => message.content.toLowerCase().includes(text)))
})

const openSession = (id: string) => {
  sessions.activeSessionId = id
  ui.sessionDrawerOpen = false
  router.push('/evidence')
}

const createSession = () => {
  sessions.create()
  ui.sessionDrawerOpen = false
  router.push('/evidence')
}

const formatSessionTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (sameDay) return `今天 ${time}`
  return `${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${time}`
}
</script>

<template>
  <div class="drawer-backdrop" :hidden="!ui.sessionDrawerOpen" @click="ui.sessionDrawerOpen = false" />
  <aside class="side-drawer" :aria-hidden="!ui.sessionDrawerOpen" aria-label="工作区与研究记录">
    <div class="drawer-top">
      <div class="drawer-title">我的循医</div>
      <button class="drawer-close" type="button" aria-label="关闭研究记录" @click="ui.sessionDrawerOpen = false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <section class="user-card" aria-label="本地工作区状态">
      <div class="user-avatar">
        <svg class="dp-logo-icon avatar-logo" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect class="dp-logo-sheet" x="14" y="8" width="36" height="48" rx="8" /><path class="dp-logo-check" d="M22 22l7 7 14-15" /><path class="dp-logo-pulse" d="M19 38h8l4-10 6 19 5-12h7" /><circle class="dp-logo-node" cx="50" cy="48" r="5" /></svg>
      </div>
      <div class="user-meta">
        <div class="user-name">本地工作区</div>
        <div class="user-line">对话保存在当前浏览器</div>
        <div class="user-line">模型账户由本机循医服务管理</div>
      </div>
    </section>
    <nav class="drawer-nav" aria-label="循医抽屉导航">
      <button class="drawer-new-question" type="button" @click="createSession">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        新建循证对话
      </button>
    </nav>
    <label class="drawer-search">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m20 20-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
      <span class="sr-only">搜索研究记录</span>
      <input v-model="query" type="search" placeholder="搜索研究记录" aria-label="搜索研究记录">
    </label>
    <section class="history-panel" aria-label="研究记录">
      <div class="history-head">
        <span>研究记录</span>
        <button class="history-clear" type="button" @click="sessions.clear()">清空</button>
      </div>
      <div class="history-list">
        <button
          v-for="session in filtered"
          :key="session.id"
          class="history-item"
          :class="{ active: session.id === sessions.activeSessionId }"
          type="button"
          @click="openSession(session.id)"
        >
          <span class="history-main">
            <strong>{{ session.title || '未命名对话' }}</strong>
            <span>{{ formatSessionTime(session.updatedAt) }}</span>
          </span>
        </button>
      </div>
    </section>
  </aside>
</template>
