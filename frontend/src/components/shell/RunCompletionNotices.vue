<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSessionsStore, useUiStore } from '../../stores'

const sessions = useSessionsStore()
const ui = useUiStore()
const router = useRouter()

const openNotice = (id: string, sessionId: string) => {
  if (!sessions.sessions.some((session) => session.id === sessionId)) {
    ui.dismissRunNotice(id)
    void router.push('/clinician')
    return
  }
  sessions.activeSessionId = sessionId
  ui.dismissRunNotice(id)
  void router.push('/clinician/evidence')
}
</script>

<template>
  <div v-if="ui.completionNotices.length" class="run-completion-notices" aria-live="polite" aria-label="研究完成提醒">
    <article v-for="notice in ui.completionNotices" :key="notice.id" class="run-completion-notice">
      <button class="run-completion-main" type="button" @click="openNotice(notice.id, notice.sessionId)">
        <span class="run-completion-icon" aria-hidden="true">✓</span>
        <span class="run-completion-copy">
          <strong>本轮研究已完成</strong>
          <small>{{ notice.title || '临床问题' }}</small>
          <em>点击查看结果</em>
        </span>
      </button>
      <button class="run-completion-close" type="button" aria-label="关闭完成提醒" @click="ui.dismissRunNotice(notice.id)">×</button>
    </article>
  </div>
</template>

<style scoped>
.run-completion-notices { position: fixed; z-index: 80; right: 24px; bottom: 24px; display: grid; width: min(360px, calc(100vw - 32px)); gap: 10px; pointer-events: none; }
.run-completion-notice { display: flex; align-items: stretch; overflow: hidden; border: 1px solid rgba(8, 118, 109, .24); border-radius: 12px; background: var(--paper-bright, #fff); box-shadow: 0 14px 38px rgba(20, 42, 74, .18); pointer-events: auto; animation: run-completion-in .25s ease both; }
.run-completion-main { display: flex; min-width: 0; flex: 1; align-items: center; gap: 11px; padding: 13px 10px 13px 14px; border: 0; background: transparent; color: var(--ink, #172535); text-align: left; cursor: pointer; }
.run-completion-main:hover { background: rgba(8, 118, 109, .045); }
.run-completion-icon { display: grid; width: 26px; height: 26px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--jade, #08766d); color: #fff; font-size: 15px; font-weight: 700; }
.run-completion-copy { display: grid; min-width: 0; gap: 2px; }
.run-completion-copy strong { font-size: 13px; }
.run-completion-copy small { overflow: hidden; color: var(--ink-soft, #56636f); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.run-completion-copy em { color: var(--jade, #08766d); font-size: 11px; font-style: normal; }
.run-completion-close { width: 34px; border: 0; border-left: 1px solid var(--line, #d9e2de); background: transparent; color: var(--ink-faint, #7d888d); font-size: 20px; cursor: pointer; }
.run-completion-close:hover { background: rgba(8, 118, 109, .06); color: var(--ink, #172535); }
@keyframes run-completion-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 720px) { .run-completion-notices { right: 16px; bottom: 78px; width: calc(100vw - 32px); } }
</style>
