<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { agentService, uploadAttachment, workspaceService } from '../services'
import { useAgentRunStore, usePreferencesStore, useSessionsStore, useUiStore } from '../stores'
import type { AgentRunResponse, ClinicianDocument, Message, ModeSnapshot, RuntimeConfig } from '../types/domain'
import { buildResearchRunRequest, newId, nowIso, responseText } from '../utils/core'
import { parseReport, reportPlainText, type Reference } from '../utils/report'
import { copyText } from '../utils/browser'
import ReportRenderer from '../components/report/ReportRenderer.vue'
import RunActivity from '../components/evidence/RunActivity.vue'
import FeedbackPanel from '../components/evidence/FeedbackPanel.vue'
import { goodCases } from '../data/goodCases'
import { useAccountConnection } from '../composables/useAccountConnection'
import { useResearchDocuments } from '../composables/useResearchDocuments'

const preferences = usePreferencesStore()
const sessions = useSessionsStore()
const run = useAgentRunStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const question = ref('')
const feed = ref<HTMLElement | null>(null)
const runtimeConfig = ref<RuntimeConfig | null>(null)
const runtimeConfigError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const medicalImageInput = ref<HTMLInputElement | null>(null)
const attachmentError = ref('')
const uploadingAttachments = ref(false)
type PendingUpload = { file: File; kind: 'document' | 'medical_image' }
const pendingUploads = ref<PendingUpload[]>([])
const expandedReportMessageId = ref<string | null>(null)
const feedbackSeen = ref(false)
const {
  conversationFiles,
  conversationFilesLoading,
  selectedConversationFile,
  conversationFileContent,
  conversationFileError,
  conversationFileLoading,
  readFormalReport,
  loadConversationFiles,
  openConversationFile,
  closeConversationFile,
} = useResearchDocuments(() => sessions.active.researchSessionId)
const { accountConnection, connectionInput, connect: connectAccount, submitInput: submitConnectionInput, cancel: cancelConnection } = useAccountConnection(async () => {
  runtimeConfig.value = await agentService.getRuntimeConfig()
  preferences.applyRuntimeConfig(runtimeConfig.value)
})
const stages = {
  planning: '正在梳理问题与检索范围', retrieving: '正在检索可用证据', tooling: '正在阅读与核验资料',
  generating: '正在生成正式循证报告', network_wait: '正在等待研究服务响应', idle: '',
}
watch(() => sessions.activeSessionId, () => {
  question.value = ''
  run.queuedGuidance = []
  const sessionId = sessions.active.researchSessionId
  feedbackSeen.value = Boolean(sessionId && localStorage.getItem(`dp_xunyi_feedback_seen:${sessionId}`))
})
watch(() => route.path, (path) => {
  if (path === '/clinician') question.value = ''
})

// Subscription integrations stay implemented on the server, but are temporarily hidden from the clinician UI.
// Flip this flag when ChatGPT/Claude account connections are ready for product use again.
const showSubscriptionProviders = false
const availableModels = computed(() => runtimeConfig.value?.models.filter((item) => item.available && (showSubscriptionProviders || !item.connection_provider)) || [])
const feedbackEnabled = computed(() => runtimeConfig.value?.feedback_enabled !== false)
const providers = computed(() => availableModels.value.filter((item, index, items) =>
  items.findIndex((candidate) => candidate.provider === item.provider) === index,
))
const modelsForProvider = computed(() => availableModels.value.filter((item) => item.provider === preferences.provider))
const subscriptionProviders = computed(() => showSubscriptionProviders ? runtimeConfig.value?.models.filter((item) => item.connection_provider) || [] : [])
const questionInput = ref<HTMLTextAreaElement | null>(null)
const thinkingLevelLabel = (level: ModeSnapshot['thinkingLevel']) => ({
  off: 'off · 关闭', low: 'low · 低', medium: 'medium · 中', high: 'high · 高',
}[level])
const primaryActionLabel = computed(() => {
  if (!run.busy) return '开始研究'
  return question.value.trim() ? '加入后续追问' : '停止本轮研究'
})
const homeMode = computed(() => route.path === '/clinician')
const activeHasConversation = computed(() => sessions.active.messages.some((message) => message.role === 'user'))
const firstReportMessage = computed(() => sessions.active.messages.find((message) => message.role === 'assistant' && !message.pending && (message.reportMarkdown || message.reportPath)))
const hasConversation = computed(() => !homeMode.value && activeHasConversation.value)
const researchCount = computed(() => sessions.active.messages.filter((message) => message.role === 'user').length)
const sessionStatusLabel = computed(() => ({ draft: '待开始', active: '正在研究', complete: '可继续追踪' })[sessions.active.status])
const documentKindLabel = (kind: ClinicianDocument['kind']) => ({
  report: '最终报告', report_draft: '报告草稿', research_frame: '研究框架', artifact: '用户文件', attachment: '上传附件',
}[kind])
const documentTitle = (file: ClinicianDocument) => file.path.split('/').at(-1) || documentKindLabel(file.kind)
const intermediateConversationFiles = computed(() => conversationFiles.value.filter((file) => file.kind !== 'report'))
const hydrateHistoricalReports = async () => {
  const localSessionId = sessions.activeSessionId
  const sessionId = sessions.active.researchSessionId
  if (!sessionId) return
  const missingReports = sessions.active.messages.filter((message) =>
    message.role === 'assistant' && message.reportPath && !message.reportMarkdown)
  await Promise.all(missingReports.map(async (message) => {
    const markdown = await readFormalReport(sessionId, message.reportPath)
    if (markdown) sessions.patchMessageIn(localSessionId, message.id, { reportMarkdown: markdown })
  }))
  if (!expandedReportMessageId.value) {
    const reportMessage = [...sessions.active.messages].reverse().find((message) => message.role === 'assistant' && (message.reportMarkdown || message.reportPath))
    if (reportMessage) expandedReportMessageId.value = reportMessage.id
  }
}
watch(() => [route.path, sessions.activeSessionId, sessions.active.researchSessionId], () => {
  closeConversationFile()
  expandedReportMessageId.value = null
  if (homeMode.value) {
    conversationFiles.value = []
    return
  }
  void loadConversationFiles()
  void hydrateHistoricalReports()
}, { immediate: true })
watch(() => preferences.provider, () => {
  if (modelsForProvider.value.some((item) => item.model === preferences.model)) return
  preferences.model = modelsForProvider.value[0]?.model || ''
})
onMounted(async () => {
  try {
    runtimeConfig.value = await agentService.getRuntimeConfig()
    preferences.applyRuntimeConfig(runtimeConfig.value)
  } catch (error) {
    runtimeConfigError.value = error instanceof Error ? error.message : '无法读取服务器运行配置'
  }
})
watch(() => sessions.active.messages.length, async () => {
  await nextTick()
  feed.value?.scrollTo?.({ top: feed.value.scrollHeight, behavior: 'smooth' })
})

async function submit(input = question.value, modeOverride?: ModeSnapshot) {
  const text = input.trim()
  if (run.busy) {
    if (text) { run.queuedGuidance.push(text); question.value = '' }
    else run.stop()
    return
  }
  if (!text) return
  const localSessionId = homeMode.value && activeHasConversation.value
    ? sessions.create()
    : sessions.activeSessionId
  if (homeMode.value) await router.replace('/clinician/evidence')
  question.value = ''
  const mode = modeOverride || { ...preferences.snapshot }
  sessions.beginResearchIn(localSessionId, text)
  sessions.addMessageTo(localSessionId, {
    id: newId('msg'), role: 'user', title: '你', content: text, trace: [],
    createdAt: nowIso(), ...mode,
  })
  const pendingId = newId('msg')
  sessions.addMessageTo(localSessionId, {
    id: pendingId, role: 'assistant', title: '循医',
    content: '正在梳理问题与检索范围…', trace: [], tools: [],
    sourceQuestion: text, pending: true, stage: 'planning', createdAt: nowIso(), ...mode,
  })
  const signal = run.start()
  const requestResearchSessionId = sessions.active.researchSessionId
  let loadedServerSessionId = requestResearchSessionId
  let latestRunStatus: AgentRunResponse | null = null
  try {
    attachmentError.value = ''
    uploadingAttachments.value = pendingUploads.value.length > 0
    const uploadedAttachments = await Promise.all(pendingUploads.value.map((pending) =>
      uploadAttachment(pending.file, requestResearchSessionId || undefined)))
    const attachmentIds = uploadedAttachments.map((uploaded) => uploaded.attachment_id)
    pendingUploads.value = []
    const dto = buildResearchRunRequest(
      text,
      requestResearchSessionId,
      mode,
      preferences.provider || undefined,
      preferences.model || undefined,
      attachmentIds,
    )
    const data = await agentService.run(dto, signal, {
          onStatus: (status) => {
            latestRunStatus = status
            if (status.session_id && status.session_id !== loadedServerSessionId) {
              loadedServerSessionId = status.session_id
              sessions.setResearchSessionId(localSessionId, status.session_id)
              void loadConversationFiles(status.session_id)
            }
            if (status.stage) run.setStage(status.stage)
            else if (status.status === 'queued') run.setStage('planning')
            else if (status.status === 'running') run.setStage('retrieving')
            else if (status.status === 'cancelling') run.setStage('network_wait')
            sessions.patchMessageIn(localSessionId, pendingId, {
              runId: status.run_id,
              queryId: status.query_id || status.run_id,
              trace: status.agent_trace || [],
              progressUpdates: status.progress_updates || [],
              tools: status.tools || [],
              runStartedAt: status.started_at,
              runCompletedAt: status.completed_at,
            })
          },
          onNetworkRetry: () => { run.setStage('network_wait') },
        })
    if (data.session_id) sessions.setResearchSessionId(localSessionId, data.session_id)
    const reportMarkdown = data.report_markdown || await readFormalReport(data.session_id, data.report_path)
    if (data.session_id) await loadConversationFiles(data.session_id)
    sessions.patchMessageIn(localSessionId, pendingId, {
      runId: data.run_id,
      queryId: data.query_id || data.run_id,
      pending: false, stage: 'idle', content: responseText(data), trace: data.agent_trace || [],
      progressUpdates: data.progress_updates || [], tools: data.tools || [],
      runStartedAt: data.started_at, runCompletedAt: data.completed_at,
      reportMarkdown, reportPath: data.report_path,
    })
    if (reportMarkdown || data.report_path) expandedReportMessageId.value = pendingId
    sessions.completeResearchIn(localSessionId)
  } catch (error) {
    attachmentError.value = error instanceof Error ? error.message : '附件上传失败'
    const stopped = error instanceof DOMException && error.name === 'AbortError'
    const statusSnapshot = latestRunStatus as unknown as AgentRunResponse | undefined
    sessions.patchMessageIn(localSessionId, pendingId, {
      pending: false, stage: 'idle',
      content: stopped
        ? '已停止前端等待；后端任务可能仍会短暂收尾。'
        : `网络或后端连接异常：${error instanceof Error ? error.message : String(error)}`,
      runId: statusSnapshot?.run_id,
      queryId: statusSnapshot?.query_id || statusSnapshot?.run_id,
      trace: [
        ...(statusSnapshot?.agent_trace || []),
        { kind: stopped ? 'run.interrupted' : 'error', label: stopped ? '用户中断' : '请求异常' },
      ],
      progressUpdates: statusSnapshot?.progress_updates || [],
      tools: statusSnapshot?.tools || [],
      runStartedAt: statusSnapshot?.started_at,
      runCompletedAt: statusSnapshot?.completed_at,
    })
    sessions.completeResearchIn(localSessionId)
  } finally {
    uploadingAttachments.value = false
    run.finish()
  }
}

const addPendingFiles = (files: FileList | null, kind: PendingUpload['kind']) => {
  if (!files) return
  const allowed = /\.(?:pdf|docx?|png|jpe?g|webp|gif|txt|md)$/i
  const additions = Array.from(files).filter((file) => allowed.test(file.name) && file.size > 0 && file.size <= 25 * 1024 * 1024)
  pendingUploads.value.push(...additions.map((file) => ({ file, kind })))
  if (additions.length < files.length) attachmentError.value = '仅支持 PDF、DOC/DOCX、常见图片、TXT/Markdown，单个文件不超过 25 MB。'
  if (kind === 'medical_image') medicalImageInput.value && (medicalImageInput.value.value = '')
  else if (fileInput.value) fileInput.value.value = ''
}
const removePendingFile = (index: number) => { pendingUploads.value.splice(index, 1) }

const projectedText = (message: Message) =>
  reportPlainText(parseReport(message.content))

const copy = async (message: Message) => copyText(projectedText(message))
const speak = (message: Message) => {
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(projectedText(message).slice(0, 1200))
  utterance.lang = 'zh-CN'
  speechSynthesis.speak(utterance)
}
const share = async (message: Message) => {
  const text = projectedText(message)
  if (navigator.share) await navigator.share({ title: '循医循证报告', text })
  else await copyText(text)
}
const retry = (message: Message, detail = '') => submit(`${detail}${message.sourceQuestion || ''}`, {
  audienceMode: message.audienceMode, thinkingLevel: message.thinkingLevel, searchEnabled: message.searchEnabled,
})
const openCitation = (reference: Reference, reportPath?: string) => {
  const sessionId = sessions.active.researchSessionId
  ui.openCitation(reference, sessionId && reportPath ? { sessionId, reportPath } : undefined)
}
const openWorkspace = async (preferredPath = '') => {
  if (!conversationFiles.value.length) await loadConversationFiles()
  const target = conversationFiles.value.find((file) => file.path === preferredPath && file.kind !== 'report')
    || intermediateConversationFiles.value[0]
  if (target) await openConversationFile(target)
}
const markFeedbackSeen = () => {
  const sessionId = sessions.active.researchSessionId
  if (!sessionId) return
  feedbackSeen.value = true
  localStorage.setItem(`dp_xunyi_feedback_seen:${sessionId}`, '1')
}
const toggleReport = async (message: Message) => {
  if (expandedReportMessageId.value === message.id) {
    expandedReportMessageId.value = null
    return
  }
  if (!message.reportMarkdown && message.reportPath) {
    const markdown = await readFormalReport(sessions.active.researchSessionId || undefined, message.reportPath)
    if (markdown) sessions.patchMessage(message.id, { reportMarkdown: markdown })
  }
  expandedReportMessageId.value = message.id
}
const runQueued = (index: number) => {
  const text = run.queuedGuidance.splice(index, 1)[0]
  if (text) void submit(text)
}
const focusQuestion = async () => {
  await nextTick()
  questionInput.value?.focus()
}
const selectGoodCase = async (value: string) => {
  question.value = value
  await focusQuestion()
}
const handlePrimaryAction = () => {
  if (run.busy && !question.value.trim()) {
    run.stop()
    return
  }
  void submit()
}
</script>

<template>
  <div class="workspace-layout" :class="{ 'document-open': Boolean(selectedConversationFile) }">
    <div class="workspace-center">
      <section v-if="!hasConversation" class="hero-dp" aria-label="循医工作台">
        <div class="hero-copy">
          <span class="workspace-eyebrow">循医 · EVIDENCE WORKBOOK</span>
          <div class="hero-title">从临床问题，走到可追溯的判断。</div>
          <p>将文献、指南与临床证据编织成一份可复核的研究记录。</p>
        </div>
      </section>

      <form class="ask-bar" aria-label="循医输入区" @submit.prevent="submit()">
        <div class="mode-context" aria-live="polite">
          <strong>临床循证工作流</strong>
          <span>推理强度只控制模型的思考深度；检索、核验和正式报告保持一致。</span>
        </div>
        <div class="composer-body">
          <div class="queue-tray" :hidden="!run.queuedGuidance.length">
            <span v-for="(item, index) in run.queuedGuidance" :key="`${item}-${index}`">
              {{ item }}
              <button type="button" :disabled="run.busy" @click="runQueued(index)">发送</button>
              <button type="button" @click="run.queuedGuidance.splice(index, 1)">×</button>
            </span>
          </div>
          <textarea
            ref="questionInput"
            v-model="question"
            placeholder="输入临床问题，例如：EGFR 19del 晚期肺癌一线治疗如何选择？"
            aria-label="医学问题"
            @keydown.ctrl.enter.prevent="submit()"
            @keydown.meta.enter.prevent="submit()"
          />
          <div class="attachment-tray" aria-label="本轮附件">
            <input ref="fileInput" type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md" hidden @change="addPendingFiles(($event.target as HTMLInputElement).files, 'document')" />
            <input ref="medicalImageInput" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif" hidden @change="addPendingFiles(($event.target as HTMLInputElement).files, 'medical_image')" />
            <button type="button" :disabled="run.busy || uploadingAttachments" @click="fileInput?.click()">上传附件</button>
            <button type="button" :disabled="run.busy || uploadingAttachments" @click="medicalImageInput?.click()">上传医学图像</button>
            <span v-for="(item, index) in pendingUploads" :key="`${item.file.name}-${index}`" class="attachment-chip">
              {{ item.kind === 'medical_image' ? '医学图像 · ' : '' }}{{ item.file.name }}
              <button type="button" aria-label="移除附件" @click="removePendingFile(index)">×</button>
            </span>
                    <small v-if="uploadingAttachments">正在上传附件；随后会并行进行 OCR/文字解析…</small>
            <small v-if="attachmentError" class="attachment-error">{{ attachmentError }}</small>
          </div>
        </div>
        <div class="composer-options" aria-label="检索选项">
          <label class="runtime-select">
            <span>服务</span>
            <select v-model="preferences.provider" :disabled="run.busy || !providers.length">
              <option v-for="item in providers" :key="item.provider" :value="item.provider">{{ item.provider_label }}</option>
            </select>
          </label>
          <label class="runtime-select">
            <span>模型</span>
            <select v-model="preferences.model" :disabled="run.busy || !modelsForProvider.length">
              <option v-for="item in modelsForProvider" :key="item.model" :value="item.model">{{ item.model_label }}</option>
            </select>
          </label>
          <label class="runtime-select thinking-select">
            <span>推理强度</span>
            <select v-model="preferences.thinkingLevel" :disabled="run.busy">
              <option value="off">off · 关闭</option>
              <option value="low">low · 低</option>
              <option value="medium">medium · 中</option>
              <option value="high">high · 高</option>
            </select>
          </label>
          <span class="composer-option active" aria-label="证据检索已开启">证据检索已开启</span>
          <span v-if="runtimeConfigError" class="runtime-error">{{ runtimeConfigError }}</span>
        </div>
        <button class="send-button" :class="{ 'queue-mode': run.busy && question.trim() }" type="button" :aria-label="primaryActionLabel" @click="handlePrimaryAction">
          <svg v-if="!run.busy" width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span v-else-if="question.trim()" aria-hidden="true">＋</span>
          <span v-else>■</span>
          <span class="send-label">{{ primaryActionLabel }}</span>
        </button>
      </form>

      <section v-if="!hasConversation" class="research-trajectory" :class="{ active: run.busy }" aria-label="循证研究路径">
        <div class="trajectory-intro">
          <span>研究路径</span>
          <strong>{{ run.busy ? (stages[run.stage] || '正在推进研究') : '问题 · 证据 · 判断' }}</strong>
        </div>
        <ol>
          <li :class="{ current: run.busy && run.stage === 'planning', complete: run.busy && run.stage !== 'planning' }"><i />界定问题</li>
          <li :class="{ current: run.busy && ['retrieving', 'tooling'].includes(run.stage), complete: run.busy && run.stage === 'generating' }"><i />检索核验</li>
          <li :class="{ current: run.busy && run.stage === 'generating' }"><i />形成报告</li>
        </ol>
      </section>

      <div class="app-desktop-grid">
        <section v-if="!hasConversation" class="feature-section" aria-label="循医场景">
          <div class="feature-header">
            <span><strong>循证示例</strong><small>按科室选择一个完整案例，也可以在输入框中继续修改问题</small></span>
          </div>
          <div class="feature-track" aria-label="循医问题场景滑动列表">
            <button
              v-for="(item, index) in goodCases"
              :key="item.id"
              class="feature-card example"
              :class="{ primary: index === 0 }"
              type="button"
              :data-case-id="item.id"
              @click="selectGoodCase(item.question)"
            >
              <span class="feature-icon">{{ item.department }}</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.summary }}</small>
              <em>填入对话框</em>
            </button>
          </div>
        </section>

        <section v-if="hasConversation" ref="feed" class="chat-feed" aria-label="循医对话">
          <header class="conversation-context">
            <div class="conversation-context-copy">
              <span>长期追踪问题</span>
              <strong>{{ sessions.active.clinicalQuestion || sessions.active.title }}</strong>
              <small><i :class="sessions.active.status" aria-hidden="true" />{{ sessionStatusLabel }} · 第 {{ researchCount }} 次研究</small>
            </div>
            <button type="button" @click="openWorkspace()">查看本题文档</button>
          </header>
          <article
            v-for="message in sessions.active.messages"
            :key="message.id"
            class="chat-message"
            :class="message.role"
          >
            <div class="bubble">
              <div class="message-heading">
                <strong>{{ message.title }}</strong>
                <span v-if="message.role === 'assistant'" class="message-mode">{{ thinkingLevelLabel(message.thinkingLevel) }}</span>
              </div>
              <div v-if="message.pending" class="agent-stage">{{ stages[run.stage] || '正在调用循证引擎…' }}</div>
              <RunActivity
                v-if="message.role === 'assistant'"
                :trace="message.trace"
                :progress-updates="message.progressUpdates"
                :tools="message.tools"
                :pending="message.pending"
                :started-at="message.runStartedAt"
                :completed-at="message.runCompletedAt"
              />
              <ReportRenderer
                v-if="message.role === 'assistant' && !message.pending"
                :markdown="message.content"
                :audience="message.audienceMode"
                @citation="openCitation($event, message.reportPath)"
              />
              <p v-else>{{ message.content }}</p>
              <section v-if="message.role === 'assistant' && !message.pending && (message.reportMarkdown || message.reportPath)" class="report-attachment" aria-label="正式报告附件">
                <button class="report-attachment-card" type="button" :aria-expanded="expandedReportMessageId === message.id" @click="toggleReport(message)">
                  <span class="report-attachment-icon" aria-hidden="true">＋</span>
                  <span class="report-attachment-copy">
                    <strong>最终报告</strong>
                    <small>{{ message.reportPath?.split('/').at(-1) || '本轮研究结论与依据' }}</small>
                  </span>
                  <span class="report-attachment-action">{{ expandedReportMessageId === message.id ? '收起' : '展开' }} <i aria-hidden="true">{{ expandedReportMessageId === message.id ? '⌃' : '⌄' }}</i></span>
                </button>
                <section v-if="expandedReportMessageId === message.id" class="final-report" aria-label="正式报告">
                  <header class="final-report-head">
                    <div>
                      <span>最终报告</span>
                      <strong>本轮研究结论与依据</strong>
                    </div>
                    <small>已保存</small>
                  </header>
                  <ReportRenderer
                    v-if="message.reportMarkdown"
                    :markdown="message.reportMarkdown"
                    :audience="message.audienceMode"
                    @citation="openCitation($event, message.reportPath)"
                  />
                  <p v-else class="document-state">正在打开正式报告…</p>
                </section>
              </section>
              <div v-if="message.role === 'assistant' && !message.pending" class="message-actions">
                <button class="message-action-primary" type="button" @click="focusQuestion">继续追问</button>
                <button type="button" @click="retry(message, '请用更简洁、适合快速决策的方式回答：')">简化结论</button>
                <button type="button" @click="retry(message, '请展开 PICO、证据等级、引用依据和复核点：')">展开依据</button>
                <details class="message-more-actions">
                  <summary>更多</summary>
                  <div>
                    <button type="button" @click="copy(message)">复制</button>
                    <button type="button" @click="speak(message)">朗读</button>
                    <button type="button" @click="share(message)">分享</button>
                    <button type="button" @click="retry(message)">重新运行</button>
                    <button v-if="message.reportMarkdown || message.reportPath" type="button" @click="toggleReport(message)">{{ expandedReportMessageId === message.id ? '收起最终报告' : '展开最终报告' }}</button>
                  </div>
                </details>
              </div>
              <FeedbackPanel
                v-if="feedbackEnabled && !feedbackSeen && firstReportMessage?.id === message.id && message.reportMarkdown && message.runId && sessions.active.researchSessionId"
                :session-id="sessions.active.researchSessionId"
                :run-id="message.queryId || message.runId"
                :show-preferred-tool="researchCount >= 3"
                @closed="markFeedbackSeen"
              />
            </div>
          </article>
        </section>
      </div>

    </div>

    <aside v-if="hasConversation" class="conversation-files-panel" aria-label="本次研究文件">
      <div class="conversation-files-head">
        <span>本题文档</span>
      </div>
      <p v-if="conversationFilesLoading">正在同步研究文件…</p>
      <p v-else-if="!intermediateConversationFiles.length">研究过程文件会出现在这里；最终报告请在回答下方展开。</p>
      <nav v-else class="conversation-document-list" aria-label="本题可读文档">
        <button
          v-for="file in intermediateConversationFiles"
          :key="file.path"
          type="button"
          :class="{ active: selectedConversationFile?.path === file.path }"
          @click="openConversationFile(file)"
        >
          <span>{{ documentKindLabel(file.kind) }}</span>
          <strong>{{ documentTitle(file) }}</strong>
        </button>
      </nav>
    </aside>

    <aside v-if="hasConversation && selectedConversationFile" class="session-document-panel" aria-label="本题文档预览">
      <header class="session-document-head">
        <div>
          <span>{{ documentKindLabel(selectedConversationFile.kind) }}</span>
          <strong>{{ documentTitle(selectedConversationFile) }}</strong>
        </div>
        <button type="button" aria-label="关闭文档预览" @click="closeConversationFile">关闭</button>
      </header>
      <div class="session-document-body">
        <p v-if="conversationFileLoading" class="document-state">正在打开文档…</p>
        <p v-else-if="conversationFileError" class="document-state error">{{ conversationFileError }}</p>
        <ReportRenderer
          v-else-if="conversationFileContent && selectedConversationFile?.previewable !== false"
          :markdown="conversationFileContent"
          audience="clinician"
          @citation="openCitation($event, selectedConversationFile.kind === 'report' ? selectedConversationFile.path : undefined)"
        />
        <div v-else class="document-download-state">
          <p>该文件不适合在页面内预览。</p>
          <a :href="workspaceService.downloadUrl(sessions.active.researchSessionId || '', selectedConversationFile.path)" download>下载文件</a>
        </div>
      </div>
    </aside>

    <aside v-else class="workspace-info-panel" aria-label="工作台信息">
      <section class="workspace-info-card evidence-status-card">
        <div class="workspace-info-title">
          <span>运行状态</span>
          <span class="workspace-live"><i />{{ runtimeConfigError ? '配置异常' : '已连接' }}</span>
        </div>
        <strong>{{ runtimeConfig ? '服务器配置已读取' : '正在读取服务器配置' }}</strong>
        <div class="evidence-source-list">
          <div><span>服务</span><small>{{ providers.find((item) => item.provider === preferences.provider)?.provider_label || '未选择' }}</small></div>
          <div><span>模型</span><small>{{ modelsForProvider.find((item) => item.model === preferences.model)?.model_label || '使用服务器默认值' }}</small></div>
          <div><span>检索</span><small>按需调用证据工具</small></div>
        </div>
      </section>
      <section v-if="showSubscriptionProviders && subscriptionProviders.length" class="workspace-info-card account-connect-card">
        <div class="workspace-info-title"><span>订阅账户</span></div>
        <p>连接后的账户可直接在模型选择器中使用。</p>
        <div v-for="item in subscriptionProviders" :key="item.connection_provider" class="account-provider-row">
          <div>
            <strong>{{ item.provider_label }}</strong>
            <small :class="{ connected: item.available }">{{ item.available ? '已连接，可直接使用' : '尚未连接' }}</small>
          </div>
          <button
            class="account-connect-button"
            :class="{ secondary: item.available }"
            type="button"
            :disabled="accountConnection?.status === 'waiting'"
            @click="connectAccount(item.connection_provider || '')"
          >{{ item.available ? '重新连接' : '连接账户' }}</button>
        </div>
      </section>
      <section v-if="showSubscriptionProviders && accountConnection" class="workspace-info-card account-connect-card" aria-live="polite">
        <div class="workspace-info-title"><span>账户连接</span><strong>{{ accountConnection.status === 'waiting' ? '进行中' : accountConnection.status === 'connected' ? '已连接' : '未完成' }}</strong></div>
        <p>{{ accountConnection.message }}</p>
        <a v-if="accountConnection.authorization?.url" class="account-connect-button" :href="accountConnection.authorization.url" target="_blank" rel="noopener">打开授权页面</a>
        <a v-if="accountConnection.authorization?.verification_url" class="account-connect-button" :href="accountConnection.authorization.verification_url" target="_blank" rel="noopener">打开设备授权页面</a>
        <p v-if="accountConnection.authorization?.device_code" class="account-device-code">授权码：{{ accountConnection.authorization.device_code }}</p>
        <div v-if="accountConnection.prompt" class="account-prompt">
          <span>{{ accountConnection.prompt.message }}</span>
          <div v-if="accountConnection.prompt.type === 'select'" class="account-choice-list">
            <button v-for="option in accountConnection.prompt.options" :key="option.id" type="button" @click="submitConnectionInput(option.id)">{{ option.label }}</button>
          </div>
          <form v-else @submit.prevent="submitConnectionInput()">
            <input v-model="connectionInput" :placeholder="accountConnection.prompt.placeholder || '输入授权码'" />
            <button type="submit">继续</button>
          </form>
        </div>
        <button v-if="accountConnection.status === 'waiting'" class="account-cancel-button" type="button" @click="cancelConnection">取消</button>
      </section>
      <section class="workspace-info-card">
        <div class="workspace-info-title"><span>当前工作模式</span></div>
        <div class="workspace-mode-list">
          <div><span>推理强度</span><strong>{{ thinkingLevelLabel(preferences.thinkingLevel) }}</strong></div>
          <div><span>证据检索</span><strong class="mode-on">开启</strong></div>
          <div><span>工作台</span><strong>医生专业版</strong></div>
        </div>
      </section>
      <div class="workspace-trust-note">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>AI 结果用于循证辅助，不替代医生诊断与临床决策。</span>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.attachment-tray { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; padding: 8px 0 0; color: var(--ink-faint, #7d888d); font-size: 12px; }
.attachment-tray > button { padding: 5px 8px; border: 1px solid rgba(49, 123, 107, .24); border-radius: 5px; background: rgba(255, 255, 255, .72); color: var(--ink-soft, #56636f); cursor: pointer; }
.attachment-tray > button:disabled { cursor: not-allowed; opacity: .55; }
.attachment-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 260px; padding: 4px 6px; border-radius: 5px; background: rgba(49, 123, 107, .1); color: var(--ink-soft, #56636f); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.attachment-error { color: #a43d36; }
</style>
