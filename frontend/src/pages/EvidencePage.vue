<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { agentService, archiveService } from '../services'
import { useAgentRunStore, usePreferencesStore, useSessionsStore, useUiStore } from '../stores'
import type { AttachmentData, BackendVersion, Message, ModeSnapshot } from '../types/domain'
import { buildAgentRequest, newId, nowIso, responseText } from '../utils/core'
import { parseReport, projectReport, reportPlainText, type Reference } from '../utils/report'
import { copyText } from '../utils/browser'
import ReportRenderer from '../components/report/ReportRenderer.vue'
import EvidenceDebugPanel from '../components/evidence/EvidenceDebugPanel.vue'
import { goodCases } from '../data/goodCases'

const preferences = usePreferencesStore()
const sessions = useSessionsStore()
const run = useAgentRunStore()
const ui = useUiStore()
const question = ref('')
const attachments = ref<AttachmentData[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const feed = ref<HTMLElement | null>(null)
const MAX_ATTACHMENT = 8 * 1024 * 1024
const stages = {
  planning: '规划问题', retrieving: '检索证据', tooling: '调用工具',
  generating: '生成回答', network_wait: '等待后端', idle: '',
}
watch(() => sessions.activeSessionId, () => {
  question.value = ''
  attachments.value = []
  run.queuedGuidance = []
})

watch(() => sessions.active.messages.length, async () => {
  await nextTick()
  feed.value?.scrollTo({ top: feed.value.scrollHeight, behavior: 'smooth' })
})

const readFile = (file: File) => new Promise<AttachmentData>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve({
    id: newId('attachment'), name: file.name, size: file.size,
    type: file.type || 'application/octet-stream', dataUrl: String(reader.result),
  })
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

const addFiles = async (files: FileList | null) => {
  for (const file of Array.from(files || [])) {
    if (file.size > MAX_ATTACHMENT) { window.alert(`${file.name} 超过 8MB`); continue }
    attachments.value.push(await readFile(file))
  }
  if (fileInput.value) fileInput.value.value = ''
}

const backendInstruction = '请统一使用中文回答。遵循“检索-核验-合成”，每条关键医学判断给出直接支持的引用编号；如有急症或红旗风险先做安全分层。'

async function submit(input = question.value, modeOverride?: ModeSnapshot, backendOverride?: BackendVersion) {
  const text = input.trim()
  if (run.busy) {
    if (text) { run.queuedGuidance.push(text); question.value = '' }
    else run.stop()
    return
  }
  if (!text && !attachments.value.length) return
  const backendVersion = backendOverride || preferences.backendVersion
  if (backendVersion === 'v2' && attachments.value.length) {
    window.alert('TypeScript Agent v2 首版暂不支持附件，请移除附件或切换回 V1。')
    return
  }
  const selected = attachments.value.splice(0)
  question.value = ''
  const visible = text || '请分析我上传的附件'
  const mode = modeOverride || { ...preferences.snapshot }
  sessions.titleFromQuestion(visible)
  sessions.addMessage({
    id: newId('msg'), role: 'user', title: '你', content: visible, trace: [], attachments: selected,
    createdAt: nowIso(), backendVersion, ...mode,
  })
  const pendingId = newId('msg')
  sessions.addMessage({
    id: pendingId, role: 'assistant', title: 'DP循医 Agent',
    content: backendVersion === 'v2' ? '正在调用 TypeScript Agent v2 调研证据…' : '正在调研证据…', trace: [],
    sourceQuestion: text, pending: true, stage: 'planning', createdAt: nowIso(), backendVersion, ...mode,
  })
  const signal = run.start()
  try {
    const attachmentSummary = selected.length
      ? `\n\n附件：\n${selected.map((file) => `- ${file.name} (${Math.round(file.size / 1024)} KB)`).join('\n')}`
      : ''
    const dto = buildAgentRequest(
      text,
      `${backendInstruction}\n\n${text || '请分析附件'}${attachmentSummary}`,
      selected,
      backendVersion === 'v1' ? sessions.active.ebmSessionId || '' : '',
      mode,
    )
    const data = backendVersion === 'v2'
      ? await agentService.runV2(dto, signal, {
          sessionId: sessions.active.v2SessionId || undefined,
          onStatus: (status) => {
            if (status.status === 'queued') run.stage = 'planning'
            if (status.status === 'running') run.stage = 'tooling'
            if (status.status === 'cancelling') run.stage = 'network_wait'
          },
          onNetworkRetry: () => { run.stage = 'network_wait' },
        })
      : await agentService.runV1(dto, signal)
    if (backendVersion === 'v2') sessions.active.v2SessionId = data.session_id || sessions.active.v2SessionId
    else sessions.active.ebmSessionId = data.session_id || sessions.active.ebmSessionId
    sessions.patchMessage(pendingId, {
      pending: false, stage: 'idle', content: responseText(data), trace: data.agent_trace || [],
      archive: data.archive, citationAudit: data.citation_audit, uploadedTexts: data.uploaded_texts,
    })
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === 'AbortError'
    sessions.patchMessage(pendingId, {
      pending: false, stage: 'idle',
      content: stopped
        ? '已停止前端等待；后端任务可能仍会短暂收尾。'
        : `网络或后端连接异常：${error instanceof Error ? error.message : String(error)}`,
      trace: [{ kind: stopped ? 'run.interrupted' : 'error', label: stopped ? '用户中断' : '请求异常' }],
    })
  } finally {
    run.finish()
  }
}

const projectedText = (message: Message) =>
  reportPlainText(projectReport(parseReport(message.content), message.audienceMode))

const copy = async (message: Message) => copyText(projectedText(message))
const speak = (message: Message) => {
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(projectedText(message).slice(0, 1200))
  utterance.lang = 'zh-CN'
  speechSynthesis.speak(utterance)
}
const share = async (message: Message) => {
  const text = projectedText(message)
  if (navigator.share) await navigator.share({ title: 'DP循医循证报告', text })
  else await copyText(text)
}
const retry = (message: Message, detail = '') => submit(`${detail}${message.sourceQuestion || ''}`, {
  researchMode: message.researchMode, audienceMode: message.audienceMode,
  deepThink: message.deepThink, searchEnabled: message.searchEnabled,
}, message.backendVersion || 'v1')
const openCitation = (reference: Reference) => ui.openCitation(reference)
const openArchive = async (message: Message) => {
  const archive = message.archive
  if (!archive) return
  ui.openDetail('证据档案', { run: archive, answer: message.content }, 'archive')
  const id = archive.archive_id || archive.run_id || archive.id
  if (id !== undefined) {
    try { ui.detailPayload = await archiveService.detail(id) } catch { /* keep summary */ }
  }
}
const runQueued = (index: number) => {
  const text = run.queuedGuidance.splice(index, 1)[0]
  if (text) void submit(text)
}
const toggleDeepThink = () => { if (!run.busy) preferences.deepThink = !preferences.deepThink }
const toggleSearch = () => { if (!run.busy) preferences.searchEnabled = !preferences.searchEnabled }
</script>

<template>
  <div class="workspace-layout">
    <div class="workspace-center">
      <section class="hero-dp" aria-label="DP循医 AI Workspace">
        <div>
          <div class="hero-title">今天想查询什么医学问题？</div>
          <p>基于文献、指南与临床证据，生成可追溯的循证分析。</p>
        </div>
      </section>

      <form class="ask-bar" aria-label="DP循医 Agent 输入区" @submit.prevent="submit()">
        <input ref="fileInput" class="hidden-control" type="file" multiple accept="image/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx" aria-label="上传 PDF、病例、图片或文档" @change="addFiles(($event.target as HTMLInputElement).files)">
        <div class="mode-toolbar" aria-label="回答模式">
          <div class="mode-group">
            <span class="mode-group-label">工作模式</span>
            <fieldset class="mode-segment">
              <legend class="sr-only">循证工作模式</legend>
              <button class="mode-button" :class="{ active: preferences.researchMode === 'instant' }" type="button" :aria-pressed="preferences.researchMode === 'instant'" :disabled="run.busy" @click="preferences.setResearchMode('instant')">Instant</button>
              <button class="mode-button" :class="{ active: preferences.researchMode === 'expert' }" type="button" :aria-pressed="preferences.researchMode === 'expert'" :disabled="run.busy" @click="preferences.setResearchMode('expert')">Expert</button>
            </fieldset>
          </div>
          <div class="mode-group">
            <span class="mode-group-label">回答对象</span>
            <fieldset class="mode-segment">
              <legend class="sr-only">回答对象</legend>
              <button class="mode-button" :class="{ active: preferences.audienceMode === 'clinician' }" type="button" :aria-pressed="preferences.audienceMode === 'clinician'" :disabled="run.busy" @click="preferences.audienceMode = 'clinician'">医生专业版</button>
              <button class="mode-button" :class="{ active: preferences.audienceMode === 'public' }" type="button" :aria-pressed="preferences.audienceMode === 'public'" :disabled="run.busy" @click="preferences.audienceMode = 'public'">普通用户版</button>
            </fieldset>
          </div>
        </div>
        <button class="upload-button" type="button" aria-label="上传 PDF、病例、图片或文档" @click="fileInput?.click()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          <span>上传文件</span>
        </button>
        <div class="composer-body">
          <div class="attachment-tray" :hidden="!attachments.length">
            <span v-for="(file, index) in attachments" :key="file.id">
              {{ file.name }}
              <button type="button" @click="attachments.splice(index, 1)">×</button>
            </span>
          </div>
          <div class="queue-tray" :hidden="!run.queuedGuidance.length">
            <span v-for="(item, index) in run.queuedGuidance" :key="`${item}-${index}`">
              {{ item }}
              <button type="button" :disabled="run.busy" @click="runQueued(index)">发送</button>
              <button type="button" @click="run.queuedGuidance.splice(index, 1)">×</button>
            </span>
          </div>
          <textarea
            v-model="question"
            placeholder="输入临床问题，例如：EGFR 19del 晚期肺癌一线治疗如何选择？"
            aria-label="医学问题"
            @keydown.ctrl.enter.prevent="submit()"
            @keydown.meta.enter.prevent="submit()"
          />
        </div>
        <div class="composer-support" aria-label="支持的上传类型">
          <span>PDF</span><span>病例</span><span>图片</span>
        </div>
        <div class="composer-options" aria-label="检索选项">
          <button
            class="composer-option"
            type="button"
            :aria-pressed="preferences.backendVersion === 'v2'"
            :class="{ active: preferences.backendVersion === 'v2' }"
            :disabled="run.busy"
            @click="preferences.backendVersion = preferences.backendVersion === 'v1' ? 'v2' : 'v1'"
          >后端：{{ preferences.backendVersion.toUpperCase() }}</button>
          <button class="composer-option" type="button" :aria-pressed="preferences.deepThink" :class="{ active: preferences.deepThink }" :disabled="run.busy" @click="toggleDeepThink">深度思考</button>
          <button class="composer-option" type="button" :aria-pressed="preferences.searchEnabled" :class="{ active: preferences.searchEnabled }" :disabled="run.busy" @click="toggleSearch">证据检索</button>
        </div>
        <button class="voice-button secondary-action" type="button" aria-label="语音输入">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3ZM6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button class="send-button" type="button" :aria-label="run.busy ? '停止' : '提交问题'" @click="submit()">
          <svg v-if="!run.busy" width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span v-else>■</span>
        </button>
      </form>

      <div class="quick-upload-row" aria-label="快捷上传">
        <span>快捷上传</span>
        <button type="button" @click="fileInput?.click()">上传 PDF</button>
        <button type="button" @click="fileInput?.click()">导入病例</button>
        <button type="button" @click="fileInput?.click()">上传图片</button>
      </div>

      <div class="app-desktop-grid">
        <section class="feature-section" aria-label="DP循医 Agent 场景">
          <div class="feature-header">
            <span><strong>循证 Good Cases</strong><small>来自跨科室正式标记 good_case 的完整检索与引用链案例</small></span>
          </div>
          <div class="feature-track" aria-label="DP循医 Agent 问题场景滑动列表">
            <button
              v-for="(item, index) in goodCases"
              :key="item.id"
              class="feature-card example"
              :class="{ primary: index === 0 }"
              type="button"
              :data-case-id="item.id"
              @click="question = item.question"
            >
              <span class="feature-icon">{{ item.department }}</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.summary }}</small>
              <em>填入对话框</em>
            </button>
          </div>
        </section>

        <section ref="feed" class="chat-feed" aria-label="DP循医 Agent 对话">
          <article
            v-for="message in sessions.active.messages"
            :key="message.id"
            class="chat-message"
            :class="message.role"
          >
            <div class="bubble">
              <strong>{{ message.title }}</strong>
              <div v-if="message.pending" class="agent-stage">{{ stages[run.stage] || '正在调用循证引擎…' }}</div>
              <ReportRenderer
                v-else-if="message.role === 'assistant' && !message.showMarkdown"
                :markdown="message.content"
                :audience="message.audienceMode"
                :research-mode="message.researchMode"
                @citation="openCitation"
              />
              <pre v-else-if="message.showMarkdown && message.audienceMode === 'clinician'">{{ message.content }}</pre>
              <p v-else>{{ message.content }}</p>
              <div v-if="message.attachments?.length" class="attachment-tray">
                <span v-for="file in message.attachments" :key="file.id">{{ file.name }}</span>
              </div>
              <div v-if="message.role === 'assistant' && !message.pending" class="message-actions">
                <button type="button" @click="copy(message)">复制</button>
                <button type="button" @click="speak(message)">朗读</button>
                <button type="button" @click="share(message)">分享</button>
                <button type="button" @click="retry(message)">重试</button>
                <button type="button" @click="retry(message, '请用更简洁、适合快速决策的方式回答：')">简化</button>
                <button type="button" @click="retry(message, '请展开 PICO、证据等级、引用依据和复核点：')">详细</button>
                <button v-if="message.audienceMode === 'clinician'" type="button" @click="sessions.patchMessage(message.id, { showMarkdown: !message.showMarkdown })">Markdown</button>
                <button v-if="message.archive" type="button" @click="openArchive(message)">查看档案</button>
              </div>
            </div>
          </article>
        </section>
      </div>

      <section class="continue-work-section" aria-label="继续上次工作">
        <div class="continue-work-header">
          <strong>继续上次工作</strong>
          <span>最近的循证任务</span>
        </div>
        <div class="continue-work-list">
          <article class="continue-work-card">
            <span class="continue-work-icon">CKD</span>
            <div>
              <strong>CKD / SGLT2 证据报告</strong>
              <span>更新于 18 分钟前 · <em class="status-review">引用复核中</em></span>
            </div>
            <button class="example" type="button" @click="question = '继续分析 CKD / SGLT2 证据报告，并优先完成引用复核。'">继续分析</button>
          </article>
          <article class="continue-work-card">
            <span class="continue-work-icon">RA</span>
            <div>
              <strong>RA 升级治疗</strong>
              <span>更新于昨天 · <em class="status-ready">已生成证据摘要</em></span>
            </div>
            <button class="example" type="button" @click="question = '继续查看 RA 升级治疗的证据摘要，并补充关键安全性比较。'">查看结果</button>
          </article>
        </div>
      </section>
    </div>

    <aside class="workspace-info-panel" aria-label="工作台信息">
      <section class="workspace-info-card evidence-status-card">
        <div class="workspace-info-title">
          <span>Evidence 数据源</span>
          <span class="workspace-live"><i />已连接</span>
        </div>
        <strong>循证数据源已就绪</strong>
        <div class="evidence-source-list">
          <div><span>PubMed</span><small><i />已连接 · 实时</small></div>
          <div><span>PMC</span><small><i />已连接 · 按需</small></div>
          <div><span>Guidelines</span><small><i />已连接 · 今日</small></div>
          <div><span>ClinicalTrials</span><small><i />已连接 · 今日</small></div>
        </div>
      </section>
      <section class="workspace-info-card">
        <div class="workspace-info-title"><span>当前工作模式</span></div>
        <div class="workspace-mode-list">
          <div><span>Agent 后端</span><strong :class="{ 'mode-on': preferences.backendVersion === 'v2' }">{{ preferences.backendVersion.toUpperCase() }}</strong></div>
          <div><span>研究模式</span><strong>{{ preferences.researchMode === 'expert' ? 'Expert' : 'Instant' }}</strong></div>
          <div><span>深度思考</span><strong>{{ preferences.deepThink ? '开启' : '关闭' }}</strong></div>
          <div><span>证据检索</span><strong :class="{ 'mode-on': preferences.searchEnabled }">{{ preferences.searchEnabled ? '开启' : '关闭' }}</strong></div>
          <div><span>回答对象</span><strong>{{ preferences.audienceMode === 'public' ? '普通用户版' : '医生专业版' }}</strong></div>
        </div>
      </section>
      <section class="workspace-info-card">
        <div class="workspace-info-title"><span>今日更新</span></div>
        <div class="workspace-update-grid">
          <div><strong>12</strong><span>新增指南</span></div>
          <div><strong>26</strong><span>系统综述</span></div>
          <div><strong>48</strong><span>新增 RCT</span></div>
        </div>
        <p>以上为工作台静态摘要，实际检索结果以数据源返回为准。</p>
      </section>
      <div class="workspace-trust-note">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>AI 结果用于循证辅助，不替代医生诊断与临床决策。</span>
      </div>
    </aside>
    <EvidenceDebugPanel />
  </div>
</template>
