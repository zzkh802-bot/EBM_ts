<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentRunStore, usePatientIntakeStore, useUiStore } from '../../stores'

const intake = usePatientIntakeStore()
const run = useAgentRunStore()
const ui = useUiStore()
const router = useRouter()
const query = ref('')

const lastQuestionAt = (session: (typeof intake.sessions)[number]) =>
  [...session.messages].reverse().find((message) => message.role === 'user')?.createdAt || session.updatedAt
const filtered = computed(() => {
  const text = query.value.trim().toLowerCase()
  return intake.sessions
    .filter((session) => session.messages.some((message) => message.role === 'user')
      && (!text || session.title.toLowerCase().includes(text)
        || session.messages.some((message) => message.content.toLowerCase().includes(text))))
    .sort((left, right) => lastQuestionAt(right).localeCompare(lastQuestionAt(left)))
})
const questionCount = (session: (typeof intake.sessions)[number]) => session.messages.filter((message) => message.role === 'user').length
const sessionStatus = (session: (typeof intake.sessions)[number]) => session.messages.some((message) => message.pending)
  ? { className: 'active', label: '回答中' }
  : session.serverStarted ? { className: 'complete', label: '可继续问' }
    : { className: 'draft', label: '本机草稿' }
const formatSessionTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return sameDay ? `今天 ${time}` : `${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${time}`
}
const openSession = (id: string) => {
  intake.select(id)
  ui.sessionDrawerOpen = false
  void router.push('/patient/intake')
}
const createSession = () => {
  ui.sessionDrawerOpen = false
  void router.push('/patient')
}
const clearSessions = () => {
  if (run.anyBusy) return
  if (window.confirm('清空本机的患者问答列表？\n\n仅清除当前浏览器显示的列表，不影响服务端已经归档的报告。')) intake.clear()
}
</script>

<template>
  <div class="drawer-backdrop" :hidden="!ui.sessionDrawerOpen" @click="ui.sessionDrawerOpen = false" />
  <aside class="side-drawer patient-session-drawer" :aria-hidden="!ui.sessionDrawerOpen" aria-label="患者问答记录">
    <div class="drawer-top">
      <div class="drawer-title">我的健康问答</div>
      <button class="drawer-close" type="button" aria-label="关闭问答记录" @click="ui.sessionDrawerOpen = false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <section class="user-card" aria-label="患者本地问答状态">
      <div class="user-avatar">
        <svg class="dp-logo-icon avatar-logo" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect class="dp-logo-sheet" x="14" y="8" width="36" height="48" rx="8" /><path class="dp-logo-check" d="M22 22l7 7 14-15" /><path class="dp-logo-pulse" d="M19 38h8l4-10 6 19 5-12h7" /><circle class="dp-logo-node" cx="50" cy="48" r="5" /></svg>
      </div>
      <div class="user-meta">
        <div class="user-name">患者健康工作台</div>
        <div class="user-line">每个问题保留独立的健康问答上下文</div>
        <div class="user-line">与医生端研究记录分开保存</div>
      </div>
    </section>
    <nav class="drawer-nav" aria-label="患者问答抽屉导航">
      <button class="drawer-new-question" type="button" @click="createSession">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        新建健康问题
      </button>
    </nav>
    <label class="drawer-search">
      <span class="sr-only">搜索问答记录</span>
      <input v-model="query" type="search" placeholder="搜索健康问题或回答内容" aria-label="搜索健康问题或回答内容">
    </label>
    <section class="history-panel" aria-label="问答记录">
      <div class="history-head">
        <span>问答记录</span>
        <button class="history-clear" type="button" title="清空本机保存的全部患者问题" :disabled="run.anyBusy" @click="clearSessions">清空本机记录</button>
      </div>
      <div class="history-list">
        <button v-for="session in filtered" :key="session.id" class="history-item" :class="{ active: session.id === intake.activeSessionId }" type="button" @click="openSession(session.id)">
          <span class="history-main">
            <span class="history-item-topline">
              <i class="session-status-dot" :class="sessionStatus(session).className" aria-hidden="true" />
              <strong>{{ session.title || '未命名健康问题' }}</strong>
              <small>{{ sessionStatus(session).label }}</small>
            </span>
            <span class="history-question">{{ [...session.messages].reverse().find((message) => message.role === 'user')?.content || '输入一个健康问题。' }}</span>
            <span class="history-meta">{{ questionCount(session) }} 次提问 · {{ formatSessionTime(lastQuestionAt(session)) }}</span>
          </span>
        </button>
      </div>
    </section>
  </aside>
</template>
