<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentRunStore, useSessionsStore, useUiStore } from '../../stores'

const sessions = useSessionsStore()
const run = useAgentRunStore()
const ui = useUiStore()
const router = useRouter()
const query = ref('')

const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  const matching = sessions.sessions.filter((session) =>
    session.messages.some((message) => message.role === 'user')
    && (!text
      || session.title.toLowerCase().includes(text)
      || session.clinicalQuestion.toLowerCase().includes(text)
      || session.messages.some((message) => message.content.toLowerCase().includes(text))))
  return [...matching].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

const openSession = (id: string) => {
  sessions.activeSessionId = id
  ui.sessionDrawerOpen = false
  router.push('/clinician/evidence')
}

const createSession = () => {
  ui.sessionDrawerOpen = false
  router.push('/clinician')
}

const clearSessions = () => {
  if (!run.busy) sessions.clear()
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

const questionCount = (id: string) => sessions.sessions.find((session) => session.id === id)?.messages
  .filter((message) => message.role === 'user').length || 0
const statusLabel = (status: 'draft' | 'active' | 'complete') => ({ draft: '待开始', active: '研究中', complete: '可继续追踪' })[status]
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
        <div class="user-name">临床问题工作台</div>
        <div class="user-line">每个问题保留独立的研究上下文</div>
        <div class="user-line">模型账户由本机服务管理</div>
      </div>
    </section>
    <nav class="drawer-nav" aria-label="循医抽屉导航">
      <button class="drawer-new-question" type="button" @click="createSession">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
        新建临床问题
      </button>
    </nav>
    <label class="drawer-search">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m20 20-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
      <span class="sr-only">搜索研究记录</span>
      <input v-model="query" type="search" placeholder="搜索临床问题或研究记录" aria-label="搜索临床问题或研究记录">
    </label>
    <section class="history-panel" aria-label="研究记录">
      <div class="history-head">
        <span>长期追踪</span>
        <button class="history-clear" type="button" title="清空本机保存的全部问题" :disabled="run.busy" @click="clearSessions">清空本机记录</button>
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
            <span class="history-item-topline">
              <i class="session-status-dot" :class="session.status" aria-hidden="true" />
              <strong>{{ session.title || '未命名临床问题' }}</strong>
              <small>{{ statusLabel(session.status) }}</small>
            </span>
            <span class="history-question">{{ session.clinicalQuestion || '输入一个临床问题，建立长期追踪。' }}</span>
            <span class="history-meta">{{ questionCount(session.id) }} 次研究 · {{ formatSessionTime(session.updatedAt) }}</span>
          </span>
        </button>
      </div>
    </section>
  </aside>
</template>
