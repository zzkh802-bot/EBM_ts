<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PatientHealthAnswerView from '../components/patient/PatientHealthAnswerView.vue'
import PdfDocumentViewer from '../components/evidence/PdfDocumentViewer.vue'
import RunActivity from '../components/evidence/RunActivity.vue'
import FeedbackPanel from '../components/evidence/FeedbackPanel.vue'
import MarkdownContent from '../components/report/MarkdownContent.vue'
import ReportRenderer from '../components/report/ReportRenderer.vue'
import { useResearchDocuments } from '../composables/useResearchDocuments'
import { agentService, healthService, uploadAttachment, workspaceService } from '../services'
import { useAgentRunStore, usePatientIntakeStore, usePreferencesStore, useUiStore } from '../stores'
import {
  PATIENT_FREE_CHAT_TURN_LIMIT,
  type AgentRunResponse,
  type ClinicianDocument,
  type PatientHealthAnswer,
  type PatientMessage,
  type ResearchMode,
  type RuntimeConfig,
} from '../types/domain'
import { hydrateRunReport, newId, nowIso } from '../utils/core'
import { copyText } from '../utils/browser'
import type { Reference } from '../utils/report'
import { normalizePatientHealthAnswer } from '../utils/patientHealth'

const route = useRoute()
const router = useRouter()
const intake = usePatientIntakeStore()
const preferences = usePreferencesStore()
const run = useAgentRunStore()
const ui = useUiStore()
const question = ref('')
const error = ref('')
const feed = ref<HTMLElement | null>(null)
const questionInput = ref<HTMLTextAreaElement | null>(null)
const runtimeConfig = ref<RuntimeConfig | null>(null)
const runtimeConfigError = ref('')
const healthStatus = ref<'checking' | 'online' | 'offline'>('checking')
const fileInput = ref<HTMLInputElement | null>(null)
const medicalImageInput = ref<HTMLInputElement | null>(null)
const attachmentError = ref('')
const uploadingAttachments = ref(false)
type PendingUpload = { file: File; kind: 'document' | 'medical_image' }
const pendingUploads = ref<PendingUpload[]>([])
const expandedReportMessageIds = ref<Set<string>>(new Set())
const copiedMessageId = ref('')
const feedbackClosedRunIds = ref<Set<string>>(new Set())
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
} = useResearchDocuments(() => intake.active.researchSessionId || null)

const stages = {
  planning: '正在梳理健康问题与检索范围',
  retrieving: '正在检索可靠的医学证据',
  tooling: '正在阅读并核验资料',
  generating: '正在整理健康结论与注意事项',
  network_wait: '正在等待研究服务响应',
  idle: '',
}
const homeMode = computed(() => route.path === '/patient')
const activeHasConversation = computed(() => intake.active.messages.some((message) => message.role === 'user'))
const hasConversation = computed(() => !homeMode.value && activeHasConversation.value)
const isBusy = computed(() => !homeMode.value && run.busy)
const freeChatComplete = computed(() => !homeMode.value && intake.userTurnCount >= PATIENT_FREE_CHAT_TURN_LIMIT)
const researchCount = computed(() => intake.active.messages.filter((message) => message.role === 'user').length)
const availableModels = computed(() => runtimeConfig.value?.models.filter((item) => item.available && !item.connection_provider) || [])
const providers = computed(() => availableModels.value.filter((item, index, items) =>
  items.findIndex((candidate) => candidate.provider === item.provider) === index))
const modelsForProvider = computed(() => availableModels.value.filter((item) => item.provider === preferences.provider))
const selectedProviderLabel = computed(() => providers.value.find((item) => item.provider === preferences.provider)?.provider_label || preferences.provider || '服务器默认')
const selectedModelLabel = computed(() => modelsForProvider.value.find((item) => item.model === preferences.model)?.model_label || preferences.model || '服务器默认')
const latestCompletedAssistantId = computed(() => [...intake.active.messages].reverse()
  .find((message) => message.role === 'assistant' && !message.pending && message.runId)?.id || '')
const feedbackEnabled = computed(() => runtimeConfig.value?.feedback_enabled !== false)
const modeDescription = computed(() => preferences.researchMode === 'quick'
  ? '快速模式：使用较短研究预算，尽快给出可理解的健康结论。'
  : '专家模式：使用更长研究预算，补充可展开核对的详细依据。')
const primaryActionLabel = computed(() => {
  if (!isBusy.value) return '提问'
  return question.value.trim() ? '加入后续追问' : '停止本轮问答'
})
const documentKindLabel = (kind: ClinicianDocument['kind']) => ({
  report: '详细健康报告',
  report_draft: '报告草稿',
  research_frame: '研究记录',
  artifact: '分析资料',
  attachment: '上传附件',
}[kind])
const documentTitle = (file: ClinicianDocument) => file.path.split('/').at(-1) || documentKindLabel(file.kind)
const conversationDocuments = computed(() => conversationFiles.value)

watch(() => intake.activeSessionId, (sessionId) => {
  question.value = ''
  error.value = ''
  run.bind(sessionId)
  expandedReportMessageIds.value = new Set()
})
watch(() => route.path, (path) => {
  if (path === '/patient') {
    question.value = ''
    error.value = ''
  }
})
watch(() => preferences.provider, () => {
  if (modelsForProvider.value.some((item) => item.model === preferences.model)) return
  preferences.model = modelsForProvider.value[0]?.model || ''
})
watch(() => intake.active.messages.length, async () => {
  await nextTick()
  feed.value?.scrollTo?.({ top: feed.value.scrollHeight, behavior: 'smooth' })
})

const hydrateHistoricalReports = async () => {
  const localSessionId = intake.activeSessionId
  const sessionId = intake.active.researchSessionId
  if (!sessionId) return
  const missingReports = intake.active.messages.filter((message) =>
    message.role === 'assistant' && message.reportPath && !message.reportMarkdown)
  await Promise.all(missingReports.map(async (message) => {
    const markdown = await readFormalReport(sessionId, message.reportPath)
    if (markdown) intake.patchIn(localSessionId, message.id, { reportMarkdown: markdown })
  }))
  if (!expandedReportMessageIds.value.size) {
    const latest = [...intake.active.messages].reverse().find((message) =>
      message.role === 'assistant' && (message.reportMarkdown || message.reportPath))
    if (latest) expandedReportMessageIds.value = new Set([latest.id])
  }
}
watch(() => [route.path, intake.activeSessionId, intake.active.researchSessionId], () => {
  closeConversationFile()
  expandedReportMessageIds.value = new Set()
  if (homeMode.value) {
    conversationFiles.value = []
    return
  }
  void loadConversationFiles()
  void hydrateHistoricalReports()
}, { immediate: true })

onMounted(async () => {
  const healthPromise = healthService.check()
    .then((result) => { healthStatus.value = result.ok === false ? 'offline' : 'online' })
    .catch(() => { healthStatus.value = 'offline' })
  const configPromise = agentService.getRuntimeConfig()
    .then((config) => {
      runtimeConfig.value = config
      preferences.applyRuntimeConfig(config)
    })
    .catch((reason) => {
      runtimeConfigError.value = reason instanceof Error ? reason.message : '无法读取服务器运行配置'
    })
  await Promise.allSettled([healthPromise, configPromise])
})

const addPendingFiles = (files: FileList | null, kind: PendingUpload['kind']) => {
  if (!files) return
  const allowed = /\.(?:pdf|docx?|png|jpe?g|webp|gif|txt|md)$/i
  const additions = Array.from(files).filter((file) => allowed.test(file.name) && file.size > 0 && file.size <= 25 * 1024 * 1024)
  pendingUploads.value.push(...additions.map((file) => ({ file, kind })))
  if (additions.length < files.length) attachmentError.value = '仅支持 PDF、DOC/DOCX、常见图片、TXT/Markdown，单个文件不超过 25 MB。'
  if (kind === 'medical_image') {
    if (medicalImageInput.value) medicalImageInput.value.value = ''
  } else if (fileInput.value) fileInput.value.value = ''
}
const removePendingFile = (index: number) => { pendingUploads.value.splice(index, 1) }
const focusQuestion = async () => {
  await nextTick()
  questionInput.value?.focus()
}
const selectExample = async (value: string) => {
  question.value = value
  await focusQuestion()
}
const selectResearchMode = (mode: ResearchMode) => {
  preferences.researchMode = mode
  preferences.thinkingLevel = mode === 'quick' ? 'low' : 'high'
}
const patientAnswerText = (answer?: PatientHealthAnswer, fallback = '') => {
  if (!answer) return fallback
  return [
    `结论：${answer.bottom_line}`,
    answer.actions.length ? `现在可以做：\n${answer.actions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    answer.red_flags.length ? `需要警惕：\n${answer.red_flags.map((item) => `- ${item}`).join('\n')}` : '',
    `何时就医：${answer.when_to_seek_care}`,
    answer.uncertainty ? `回答边界：${answer.uncertainty}` : '',
  ].filter(Boolean).join('\n\n')
}
const copyAnswer = async (message: PatientMessage) => {
  if (await copyText(patientAnswerText(message.health, message.content))) {
    copiedMessageId.value = message.id
    window.setTimeout(() => { if (copiedMessageId.value === message.id) copiedMessageId.value = '' }, 1500)
  }
}
const toggleReport = async (message: PatientMessage) => {
  if (expandedReportMessageIds.value.has(message.id)) {
    const next = new Set(expandedReportMessageIds.value)
    next.delete(message.id)
    expandedReportMessageIds.value = next
    return
  }
  if (!message.reportMarkdown && message.reportPath) {
    const markdown = await readFormalReport(intake.active.researchSessionId, message.reportPath)
    if (markdown) intake.patch(message.id, { reportMarkdown: markdown })
  }
  expandedReportMessageIds.value = new Set([...expandedReportMessageIds.value, message.id])
}
const openCitation = (reference: Reference, reportPath?: string) => {
  const sessionId = intake.active.researchSessionId
  ui.openCitation(reference, sessionId && reportPath ? { sessionId, reportPath } : undefined)
}
const closeFeedback = (runId: string) => {
  feedbackClosedRunIds.value = new Set([...feedbackClosedRunIds.value, runId])
}
const openWorkspace = async (preferredPath = '') => {
  if (!conversationFiles.value.length) await loadConversationFiles()
  const target = conversationFiles.value.find((file) => file.path === preferredPath)
    || [...conversationFiles.value].reverse().find((file) => file.kind === 'report')
    || conversationFiles.value.find((file) => file.kind !== 'report')
    || conversationDocuments.value[0]
  if (target) await openConversationFile(target)
}

async function submit(input = question.value) {
  const text = input.trim()
  if (!text) return
  const localSessionId = homeMode.value && activeHasConversation.value
    ? intake.create().id
    : intake.activeSessionId
  const origin = intake.sessions.find((session) => session.id === localSessionId)
  if (!origin) return
  run.bind(localSessionId)
  if (run.busy) {
    run.addGuidance(localSessionId, text)
    question.value = ''
    return
  }
  const completedTurns = origin.messages.filter((message) => message.role === 'user' && !message.failed).length
  if (completedTurns >= PATIENT_FREE_CHAT_TURN_LIMIT) {
    error.value = `本次 ${PATIENT_FREE_CHAT_TURN_LIMIT} 轮问答已结束，请新建健康问题后继续。`
    return
  }
  if (homeMode.value) await router.replace('/patient/intake')
  question.value = ''
  error.value = ''
  const selectedResearchMode = preferences.researchMode
  const userMessageId = newId('patient-user')
  intake.addTo(localSessionId, { id: userMessageId, role: 'user', content: text, createdAt: nowIso() })
  const pendingId = newId('patient-assistant')
  intake.addTo(localSessionId, {
    id: pendingId,
    role: 'assistant',
    content: '正在梳理问题并检索可靠信息…',
    createdAt: nowIso(),
    pending: true,
    trace: [],
    tools: [],
    researchMode: selectedResearchMode,
  })
  const signal = run.start(localSessionId)
  const requestResearchSessionId = origin.researchSessionId
  let loadedServerSessionId = requestResearchSessionId
  let latestRunStatus: AgentRunResponse | null = null
  try {
    attachmentError.value = ''
    uploadingAttachments.value = pendingUploads.value.length > 0
    const uploadedAttachments = await Promise.all(pendingUploads.value.map((pending) =>
      uploadAttachment(pending.file, requestResearchSessionId || localSessionId)))
    const attachmentIds = uploadedAttachments.map((uploaded) => uploaded.attachment_id)
    pendingUploads.value = []
    intake.patchIn(localSessionId, pendingId, { runStartedAt: nowIso() })
    const data = await agentService.run({
      question: text,
      ...(requestResearchSessionId ? { session_id: requestResearchSessionId } : {}),
      audience_mode: 'patient',
      thinking_level: selectedResearchMode === 'quick' ? 'low' : preferences.thinkingLevel,
      research_mode: selectedResearchMode,
      search_enabled: true,
      response_mode: 'auto',
      ...(preferences.provider ? { provider: preferences.provider } : {}),
      ...(preferences.model ? { model: preferences.model } : {}),
      ...(attachmentIds.length ? { attachments: attachmentIds } : {}),
    }, signal, {
      onStatus: (status) => {
        latestRunStatus = status
        const attachmentProcessed = status.progress_updates?.some((update) => /附件.*(?:已完成文字解析|已加入本轮研究输入)/.test(update.text))
        if (status.session_id && status.session_id !== loadedServerSessionId) {
          loadedServerSessionId = status.session_id
          intake.setResearchSessionIdIn(localSessionId, status.session_id)
          if (intake.activeSessionId === localSessionId) void loadConversationFiles(status.session_id)
        }
        if (status.session_id && attachmentProcessed && intake.activeSessionId === localSessionId) void loadConversationFiles(status.session_id)
        if (status.stage) run.setStage(localSessionId, status.stage)
        else if (status.status === 'queued') run.setStage(localSessionId, 'planning')
        else if (status.status === 'running') run.setStage(localSessionId, 'retrieving')
        else if (status.status === 'cancelling') run.setStage(localSessionId, 'network_wait')
        intake.patchIn(localSessionId, pendingId, {
          runId: status.run_id,
          queryId: status.query_id || status.run_id,
          trace: status.agent_trace || [],
          progressUpdates: status.progress_updates || [],
          tools: status.tools || [],
          runStartedAt: status.started_at,
          runCompletedAt: status.completed_at,
        })
      },
      onNetworkRetry: () => { run.setStage(localSessionId, 'network_wait') },
    })
    if (data.session_id) intake.setResearchSessionIdIn(localSessionId, data.session_id)
    intake.markServerStartedIn(localSessionId)
    const answerText = data.agent_answer || data.message || ''
    const health = normalizePatientHealthAnswer(data.patient_health, answerText)
    const reportMarkdown = await hydrateRunReport(data, readFormalReport)
    if (data.session_id && intake.activeSessionId === localSessionId) await loadConversationFiles(data.session_id)
    intake.patchIn(localSessionId, pendingId, {
      content: health?.bottom_line || answerText || '这次没有生成回答，请重试。',
      ...(health ? { health } : {}),
      ...(reportMarkdown ? { reportMarkdown } : {}),
      ...(data.report_path ? { reportPath: data.report_path } : {}),
      runId: data.run_id,
      queryId: data.query_id || data.run_id,
      pending: false,
      trace: data.agent_trace || [],
      progressUpdates: data.progress_updates || [],
      tools: data.tools || [],
      runStartedAt: data.started_at,
      runCompletedAt: data.completed_at,
    })
    if ((reportMarkdown || data.report_path) && intake.activeSessionId === localSessionId) {
      expandedReportMessageIds.value = new Set([...expandedReportMessageIds.value, pendingId])
    }
    if (intake.activeSessionId !== localSessionId || router.currentRoute.value.path !== '/patient/intake') {
      ui.notifyRunCompleted({
        sessionId: localSessionId,
        runId: data.run_id,
        title: origin.title || '健康问答',
        question: text,
        workspace: 'patient',
      })
    }
  } catch (reason) {
    const stopped = reason instanceof DOMException && reason.name === 'AbortError'
    const statusSnapshot = latestRunStatus as unknown as AgentRunResponse | undefined
    intake.patchIn(localSessionId, userMessageId, { failed: true })
    intake.patchIn(localSessionId, pendingId, {
      pending: false,
      content: stopped
        ? '已停止前端等待；后端任务可能仍会短暂收尾。'
        : `网络或后端连接异常：${reason instanceof Error ? reason.message : String(reason)}`,
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
    const sessionToRefresh = statusSnapshot?.session_id || loadedServerSessionId
    if (sessionToRefresh && intake.activeSessionId === localSessionId) await loadConversationFiles(sessionToRefresh)
    if (intake.activeSessionId === localSessionId) error.value = reason instanceof Error ? reason.message : '服务暂不可用'
  } finally {
    uploadingAttachments.value = false
    run.finish(localSessionId)
  }
}

const runQueued = (index: number) => {
  const localSessionId = intake.activeSessionId
  const text = run.queuedGuidance[index]
  run.removeGuidance(localSessionId, index)
  if (text) void submit(text)
}
const newQuestion = () => {
  question.value = ''
  error.value = ''
  void router.push('/patient')
}
const handlePrimaryAction = () => {
  if (isBusy.value && !question.value.trim()) {
    run.stop(intake.activeSessionId)
    return
  }
  void submit()
}
</script>

<template>
  <div class="workspace-layout patient-page" :class="{ 'document-open': Boolean(selectedConversationFile) }">
    <div class="workspace-center patient-center">
      <section v-if="!hasConversation" class="hero-dp" aria-label="患者健康问答">
        <div class="hero-copy">
          <span class="workspace-eyebrow">循医 · HEALTH WORKBOOK</span>
          <div class="hero-title">从健康疑问，走到清楚、可靠的下一步。</div>
          <p>先说明结论、风险和该怎么做；必要时可展开查看循证依据。回答不替代现场诊疗。</p>
        </div>
      </section>

      <form class="ask-bar" aria-label="健康问题输入区" @submit.prevent="submit()">
        <div class="mode-context" aria-live="polite">
          <strong>患者健康问答</strong>
          <span>{{ modeDescription }}</span>
        </div>
        <div class="composer-body">
          <div class="queue-tray" :hidden="homeMode || !run.queuedGuidance.length">
            <span v-for="(item, index) in run.queuedGuidance" :key="`${item}-${index}`">
              {{ item }}
              <button type="button" :disabled="isBusy" @click="runQueued(index)">发送</button>
              <button type="button" @click="run.removeGuidance(intake.activeSessionId, index)">×</button>
            </span>
          </div>
          <textarea
            ref="questionInput"
            v-model="question"
            placeholder="输入健康问题，例如：最近总睡不好，哪些情况需要去医院看看？"
            aria-label="健康问题"
            :disabled="freeChatComplete"
            @keydown.ctrl.enter.prevent="submit()"
            @keydown.meta.enter.prevent="submit()"
          />
          <div class="attachment-tray" aria-label="本轮附件">
            <input ref="fileInput" type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md" hidden @change="addPendingFiles(($event.target as HTMLInputElement).files, 'document')" />
            <input ref="medicalImageInput" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif" hidden @change="addPendingFiles(($event.target as HTMLInputElement).files, 'medical_image')" />
            <button type="button" :disabled="isBusy || uploadingAttachments" @click="fileInput?.click()">上传附件</button>
            <button type="button" :disabled="isBusy || uploadingAttachments" @click="medicalImageInput?.click()">上传医学图像</button>
            <span v-for="(item, index) in pendingUploads" :key="`${item.file.name}-${index}`" class="attachment-chip">
              {{ item.kind === 'medical_image' ? '医学图像 · ' : '' }}{{ item.file.name }}
              <button type="button" aria-label="移除附件" @click="removePendingFile(index)">×</button>
            </span>
            <small v-if="uploadingAttachments">正在上传附件；随后会进行 OCR/文字解析…</small>
            <small v-if="attachmentError" class="attachment-error">{{ attachmentError }}</small>
          </div>
        </div>
        <div class="composer-options" aria-label="问答选项">
          <label class="runtime-select">
            <span>服务</span>
            <select v-model="preferences.provider" :disabled="isBusy || !providers.length">
              <option v-for="item in providers" :key="item.provider" :value="item.provider">{{ item.provider_label }}</option>
            </select>
          </label>
          <label class="runtime-select">
            <span>模型</span>
            <select v-model="preferences.model" :disabled="isBusy || !modelsForProvider.length">
              <option v-for="item in modelsForProvider" :key="item.model" :value="item.model">{{ item.model_label }}</option>
            </select>
          </label>
          <div class="patient-mode-switch" role="group" aria-label="研究模式">
            <button type="button" :class="{ active: preferences.researchMode === 'quick' }" :aria-pressed="preferences.researchMode === 'quick'" :disabled="isBusy" @click="selectResearchMode('quick')">快速</button>
            <button type="button" :class="{ active: preferences.researchMode === 'expert' }" :aria-pressed="preferences.researchMode === 'expert'" :disabled="isBusy" @click="selectResearchMode('expert')">专家</button>
          </div>
          <span class="composer-option active" aria-label="医学证据检索已开启">证据检索已开启</span>
          <span v-if="runtimeConfigError" class="runtime-error">{{ runtimeConfigError }}</span>
        </div>
        <button class="send-button" :class="{ 'queue-mode': isBusy && question.trim() }" type="button" :aria-label="primaryActionLabel" @click="handlePrimaryAction">
          <svg v-if="!isBusy" width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span v-else-if="question.trim()" aria-hidden="true">＋</span>
          <span v-else>■</span>
          <span class="send-label">{{ primaryActionLabel }}</span>
        </button>
      </form>

      <section v-if="!hasConversation" class="research-trajectory" :class="{ active: isBusy }" aria-label="健康问答路径">
        <div class="trajectory-intro">
          <span>回答路径</span>
          <strong>问题 · 证据 · 建议</strong>
        </div>
        <ol>
          <li><i />理解问题</li>
          <li><i />检索核验</li>
          <li><i />说明下一步</li>
        </ol>
      </section>

      <div class="app-desktop-grid">
        <section v-if="!hasConversation" class="feature-section" aria-label="常见健康问题">
          <div class="feature-header">
            <span><strong>常见健康问题</strong><small>选择一个示例，也可以自己输入问题</small></span>
          </div>
          <div class="feature-track" aria-label="常见健康问题列表">
            <button
              v-for="(item, index) in [
                { id: 'cold', title: '感冒发烧怎么处理', summary: '在家先注意什么？哪些情况要尽快去医院？', question: '感冒、发烧时在家应该先注意什么？哪些情况需要尽快就医？' },
                { id: 'nosebleed', title: '孩子流鼻血怎么办', summary: '第一步该做什么？需要坐着还是躺着？', question: '孩子流鼻血时，第一步应该怎么做？' },
                { id: 'insomnia', title: '睡不好要不要就医', summary: '什么样的失眠需要去看医生？', question: '最近睡不好，哪些情况需要去医院看看？' },
                { id: 'rash', title: '皮肤出现红疹', summary: '怎么初步判断，什么时候该就医？', question: '皮肤上出现红疹、发痒，在家怎么初步处理？什么时候该去看医生？' },
              ]"
              :key="item.id"
              class="feature-card example"
              :class="{ primary: index === 0 }"
              type="button"
              @click="selectExample(item.question)"
            >
              <span class="feature-icon">日常</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.summary }}</small>
              <em>填入对话框</em>
            </button>
          </div>
        </section>

        <section v-if="hasConversation" ref="feed" class="chat-feed" aria-label="健康问答对话">
          <header class="conversation-context">
            <div class="conversation-context-copy">
              <span>当前健康问题</span>
              <strong>{{ intake.active.title }}</strong>
              <small>第 {{ researchCount }} 问 · 共 {{ intake.userTurnCount }}/{{ PATIENT_FREE_CHAT_TURN_LIMIT }} 轮</small>
            </div>
            <button type="button" @click="openWorkspace()">查看本题文档</button>
          </header>
          <article v-for="message in intake.active.messages" :key="message.id" class="chat-message" :class="message.role">
            <div class="bubble">
              <div v-if="message.role === 'assistant'" class="message-heading">
                <strong>循医</strong>
                <span v-if="message.researchMode" class="message-mode">{{ message.researchMode === 'expert' ? '专家模式' : '快速模式' }}</span>
              </div>
              <div v-if="message.pending" class="agent-stage">{{ stages[run.stage] || '正在调用健康问答服务…' }}</div>
              <RunActivity
                v-if="message.role === 'assistant'"
                :trace="message.trace || []"
                :progress-updates="message.progressUpdates"
                :tools="message.tools"
                :pending="message.pending"
                :started-at="message.runStartedAt"
                :completed-at="message.runCompletedAt"
              />
              <PatientHealthAnswerView v-if="message.role === 'assistant' && !message.pending && message.health" :answer="message.health" />
              <div v-else-if="message.role === 'assistant' && !message.pending" class="markdown-content">
                <MarkdownContent :markdown="message.content" />
              </div>
              <p v-else>{{ message.content }}</p>
              <section v-if="message.role === 'assistant' && !message.pending && (message.reportMarkdown || message.reportPath)" class="report-attachment patient-report-attachment" aria-label="详细循证报告">
                <button class="report-attachment-card" type="button" :aria-expanded="expandedReportMessageIds.has(message.id)" @click="toggleReport(message)">
                  <span class="report-attachment-icon" aria-hidden="true">＋</span>
                  <span class="report-attachment-copy">
                    <strong>详细循证报告</strong>
                    <small>{{ message.reportPath?.split('/').at(-1) || '健康结论、适用边界和参考文献' }}</small>
                  </span>
                  <span class="report-attachment-action">{{ expandedReportMessageIds.has(message.id) ? '收起' : '展开' }}</span>
                </button>
                <section v-if="expandedReportMessageIds.has(message.id)" class="final-report" aria-label="详细循证报告正文">
                  <header class="final-report-head">
                    <div><span>证据依据</span><strong>详细循证报告</strong></div>
                    <small>点击引用可核验原文</small>
                  </header>
                  <ReportRenderer v-if="message.reportMarkdown" :markdown="message.reportMarkdown" audience="patient" @citation="openCitation($event, message.reportPath)" />
                  <p v-else class="document-state">正在打开详细报告…</p>
                </section>
              </section>
              <div v-if="message.role === 'assistant' && !message.pending" class="message-actions patient-message-actions">
                <button type="button" @click="copyAnswer(message)">{{ copiedMessageId === message.id ? '已复制' : '复制回答' }}</button>
              </div>
              <FeedbackPanel
                v-if="feedbackEnabled && latestCompletedAssistantId === message.id && message.runId && intake.active.researchSessionId && !feedbackClosedRunIds.has(message.runId)"
                :session-id="intake.active.researchSessionId"
                :run-id="message.queryId || message.runId"
                audience="patient"
                @closed="closeFeedback(message.runId)"
              />
            </div>
          </article>
          <p v-if="error" class="patient-error">{{ error }}</p>
          <div v-if="freeChatComplete" class="free-chat-finished">
            <strong>本次 {{ PATIENT_FREE_CHAT_TURN_LIMIT }} 轮问答已结束</strong>
            <span>可以新建一个健康问题继续提问。</span>
            <button type="button" @click="newQuestion">新建健康问题</button>
          </div>
        </section>
      </div>
    </div>

    <aside v-if="hasConversation" class="conversation-files-panel" aria-label="本题服务端文档">
      <div class="conversation-files-head"><span>本题文档</span></div>
      <p v-if="conversationFilesLoading">正在同步服务端文档…</p>
      <p v-else-if="!conversationDocuments.length">本题生成的报告和研究记录会出现在这里。</p>
      <nav v-else class="conversation-document-list" aria-label="本题可读文档">
        <button v-for="file in conversationDocuments" :key="file.path" type="button" :class="{ active: selectedConversationFile?.path === file.path }" @click="openConversationFile(file)">
          <span>{{ documentKindLabel(file.kind) }}</span>
          <strong>{{ documentTitle(file) }}</strong>
        </button>
      </nav>
    </aside>

    <aside v-if="hasConversation && selectedConversationFile" class="session-document-panel" aria-label="本题文档预览">
      <header class="session-document-head">
        <div><span>{{ documentKindLabel(selectedConversationFile.kind) }}</span><strong>{{ documentTitle(selectedConversationFile) }}</strong></div>
        <button type="button" aria-label="关闭文档预览" @click="closeConversationFile">关闭</button>
      </header>
      <div class="session-document-body">
        <p v-if="conversationFileLoading" class="document-state">正在打开文档…</p>
        <p v-else-if="conversationFileError" class="document-state error">{{ conversationFileError }}</p>
        <template v-else-if="selectedConversationFile.kind === 'attachment'">
          <div class="attachment-original-viewer">
            <img v-if="selectedConversationFile.media_type?.startsWith('image/')" :src="workspaceService.attachmentPreviewUrl(intake.active.researchSessionId || '', selectedConversationFile.path)" :alt="documentTitle(selectedConversationFile)" />
            <PdfDocumentViewer v-else-if="selectedConversationFile.media_type === 'application/pdf'" :src="workspaceService.attachmentPreviewUrl(intake.active.researchSessionId || '', selectedConversationFile.path)" :title="documentTitle(selectedConversationFile)" />
            <p v-else class="document-state">原始文件格式不支持直接预览，请下载原件查看。</p>
          </div>
          <ReportRenderer v-if="conversationFileContent && !selectedConversationFile.media_type?.startsWith('image/') && selectedConversationFile.media_type !== 'application/pdf'" :markdown="conversationFileContent" audience="patient" />
          <div class="attachment-original-actions">
            <a :href="workspaceService.downloadUrl(intake.active.researchSessionId || '', selectedConversationFile.path)" download>下载原件</a>
          </div>
        </template>
        <ReportRenderer v-else-if="conversationFileContent && selectedConversationFile.previewable !== false" :markdown="conversationFileContent" audience="patient" @citation="openCitation($event, selectedConversationFile.kind === 'report' ? selectedConversationFile.path : undefined)" />
        <div v-else class="document-download-state">
          <p>该文件不适合在页面内预览。</p>
          <a :href="workspaceService.downloadUrl(intake.active.researchSessionId || '', selectedConversationFile.path)" download>下载文件</a>
        </div>
      </div>
    </aside>

    <aside v-else class="workspace-info-panel patient-status-panel" aria-label="患者健康版运行信息">
      <section class="workspace-info-card evidence-status-card">
        <div class="workspace-info-title">
          <span>运行状态</span>
          <span class="workspace-live" :class="{ error: healthStatus === 'offline', checking: healthStatus === 'checking' }">
            <i />{{ healthStatus === 'online' ? '服务在线' : healthStatus === 'offline' ? '服务离线' : '检测中' }}
          </span>
        </div>
        <strong>{{ runtimeConfig ? '健康问答服务已就绪' : runtimeConfigError ? '运行配置读取失败' : '正在读取运行配置' }}</strong>
        <div class="evidence-source-list">
          <div><span>健康检查</span><small>{{ healthStatus === 'online' ? '/ts-api/health 可达' : healthStatus === 'offline' ? '/ts-api/health 不可达' : '正在检查' }}</small></div>
          <div><span>运行配置</span><small>{{ runtimeConfig ? '已读取' : runtimeConfigError ? '读取失败' : '读取中' }}</small></div>
          <div><span>服务</span><small>{{ selectedProviderLabel }}</small></div>
          <div><span>模型</span><small>{{ selectedModelLabel }}</small></div>
        </div>
      </section>
      <section class="workspace-info-card">
        <div class="workspace-info-title"><span>当前工作模式</span></div>
        <div class="workspace-mode-list">
          <div><span>工作流</span><strong>{{ preferences.researchMode === 'expert' ? '专家模式' : '快速模式' }}</strong></div>
          <div><span>推理强度</span><strong>{{ preferences.researchMode === 'expert' ? 'high · 高' : 'low · 低' }}</strong></div>
          <div><span>证据检索</span><strong class="mode-on">开启</strong></div>
          <div><span>回答对象</span><strong>患者健康版</strong></div>
        </div>
      </section>
      <div class="workspace-trust-note">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>健康回答用于信息参考，不替代医生诊断、处方与现场诊疗。</span>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.patient-error { margin: 0 0 12px; color: var(--danger); font-size: 13px; }
.attachment-original-viewer { display: grid; gap: 12px; margin-bottom: 16px; }
.attachment-original-viewer img { display: block; max-width: 100%; max-height: 720px; margin: 0 auto; border: 1px solid var(--line); border-radius: 8px; object-fit: contain; background: var(--paper-muted); }
.attachment-original-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.attachment-original-actions a { color: var(--jade); font-size: 12px; text-decoration: none; }
</style>
