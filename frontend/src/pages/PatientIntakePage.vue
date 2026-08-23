<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PatientHealthAnswerView from '../components/patient/PatientHealthAnswerView.vue'
import RunActivity from '../components/evidence/RunActivity.vue'
import FeedbackPanel from '../components/evidence/FeedbackPanel.vue'
import MarkdownContent from '../components/report/MarkdownContent.vue'
import ReportRenderer from '../components/report/ReportRenderer.vue'
import RightDetailPanel from '../components/shell/RightDetailPanel.vue'
import RunCompletionNotices from '../components/shell/RunCompletionNotices.vue'
import SiteCredit from '../components/shell/SiteCredit.vue'
import { agentService, uploadAttachment, workspaceService } from '../services'
import { usePatientIntakeStore, usePreferencesStore, useUiStore } from '../stores'
import { PATIENT_FREE_CHAT_TURN_LIMIT, type PatientHealthAnswer, type PatientMessage, type ResearchMode, type RuntimeConfig } from '../types/domain'
import { hydrateRunReport, newId, nowIso } from '../utils/core'
import { copyText } from '../utils/browser'
import type { Reference } from '../utils/report'
import { normalizePatientHealthAnswer } from '../utils/patientHealth'

const router = useRouter()
const intake = usePatientIntakeStore()
const preferences = usePreferencesStore()
const ui = useUiStore()
const question = ref('')
const busy = ref(false)
const error = ref('')
const feed = ref<HTMLElement | null>(null)
const questionInput = ref<HTMLTextAreaElement | null>(null)
const runtimeConfig = ref<RuntimeConfig | null>(null)
const runtimeConfigError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const medicalImageInput = ref<HTMLInputElement | null>(null)
const attachmentError = ref('')
const uploadingAttachments = ref(false)
type PendingUpload = { file: File; kind: 'document' | 'medical_image' }
const pendingUploads = ref<PendingUpload[]>([])
const busySignal = ref<AbortController | null>(null)
const historyQuery = ref('')
const expandedReportMessageIds = ref<Set<string>>(new Set())
const copiedMessageId = ref('')
const feedbackClosedRunIds = ref<Set<string>>(new Set())

const freeChatComplete = computed(() => intake.userTurnCount >= PATIENT_FREE_CHAT_TURN_LIMIT)
const hasConversation = computed(() => intake.active.messages.some((message) => message.role === 'user'))
const activeHasConversation = computed(() => intake.active.messages.some((message) => message.role === 'user'))
const researchCount = computed(() => intake.active.messages.filter((message) => message.role === 'user').length)
const availableModels = computed(() => runtimeConfig.value?.models.filter((item) => item.available && !item.connection_provider) || [])
const providers = computed(() => availableModels.value.filter((item, index, items) =>
  items.findIndex((candidate) => candidate.provider === item.provider) === index,
))
const modelsForProvider = computed(() => availableModels.value.filter((item) => item.provider === preferences.provider))
const filteredSessions = computed(() => {
  const query = historyQuery.value.trim().toLowerCase()
  return intake.sessions.filter((session) => !query
    || session.title.toLowerCase().includes(query)
    || session.messages.some((message) => message.content.toLowerCase().includes(query)))
})
const latestCompletedAssistantId = computed(() => [...intake.active.messages].reverse()
  .find((message) => message.role === 'assistant' && !message.pending && message.runId)?.id || '')
const feedbackEnabled = computed(() => runtimeConfig.value?.feedback_enabled !== false)
const modeDescription = computed(() => preferences.researchMode === 'quick'
  ? '快速模式：8 轮研究预算，优先尽快给出可靠的健康结论。'
  : '专家模式：48 轮研究预算，生成健康结论和可展开核对的详细循证报告。')
const primaryActionLabel = computed(() => {
  if (!busy.value) return '提问'
  return question.value.trim() ? '加入后续追问' : '停止本轮问答'
})

watch(() => intake.activeSessionId, () => {
  question.value = ''
  error.value = ''
  expandedReportMessageIds.value = new Set()
})
watch(() => preferences.provider, () => {
  if (modelsForProvider.value.some((item) => item.model === preferences.model)) return
  preferences.model = modelsForProvider.value[0]?.model || ''
})
watch(() => intake.active.messages.length, async () => {
  await nextTick()
  feed.value?.scrollTo?.({ top: feed.value.scrollHeight, behavior: 'smooth' })
})

const scrollToLatest = async () => {
  await nextTick()
  feed.value?.lastElementChild?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
}
watch(() => intake.active.messages.length, () => { void scrollToLatest() })

onMounted(async () => {
  try {
    runtimeConfig.value = await agentService.getRuntimeConfig()
    preferences.applyRuntimeConfig(runtimeConfig.value)
  } catch (reason) {
    runtimeConfigError.value = reason instanceof Error ? reason.message : '无法读取服务器运行配置'
  }
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
const clearHistory = () => {
  if (busy.value) return
  if (window.confirm('清空本机保存的患者问答记录？\n\n这不会删除服务端已经归档的研究数据。')) {
    intake.clear()
    historyQuery.value = ''
  }
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
const readFormalReport = async (sessionId?: string, preferredPath?: string) => {
  if (!sessionId) return ''
  try {
    if (preferredPath) return (await workspaceService.read(sessionId, preferredPath)).content
    const report = (await workspaceService.list(sessionId)).files.find((file) => file.kind === 'report')
    return report ? (await workspaceService.read(sessionId, report.path)).content : ''
  } catch {
    return ''
  }
}
const toggleReport = async (message: PatientMessage) => {
  if (expandedReportMessageIds.value.has(message.id)) {
    expandedReportMessageIds.value.delete(message.id)
    expandedReportMessageIds.value = new Set(expandedReportMessageIds.value)
    return
  }
  if (!message.reportMarkdown && message.reportPath) {
    const markdown = await readFormalReport(intake.active.researchSessionId, message.reportPath)
    if (markdown) intake.patch(message.id, { reportMarkdown: markdown })
  }
  expandedReportMessageIds.value.add(message.id)
  expandedReportMessageIds.value = new Set(expandedReportMessageIds.value)
}
const openCitation = (reference: Reference, reportPath?: string) => {
  const sessionId = intake.active.researchSessionId
  ui.openCitation(reference, sessionId && reportPath ? { sessionId, reportPath } : undefined)
}
const closeFeedback = (runId: string) => {
  feedbackClosedRunIds.value.add(runId)
  feedbackClosedRunIds.value = new Set(feedbackClosedRunIds.value)
}

const ask = async () => {
  const text = question.value.trim()
  if (!text || busy.value || freeChatComplete.value) return
  error.value = ''
  const localSessionId = intake.activeSessionId
  const selectedResearchMode = preferences.researchMode
  if (!hasConversation.value) { question.value = '' } else { /* 追问沿用当前会话 */ }
  question.value = ''
  const userMessageId = newId('patient-user')
  intake.add({ id: userMessageId, role: 'user', content: text, createdAt: nowIso() })
  const pendingId = newId('patient-assistant')
  intake.add({
    id: pendingId, role: 'assistant', content: '正在检索并整理可靠信息，请稍候…',
    createdAt: nowIso(), pending: true, trace: [], tools: [], researchMode: selectedResearchMode,
  })
  const signal = new AbortController()
  busySignal.value = signal
  const requestResearchSessionId = intake.active.researchSessionId
  let loadedServerSessionId = requestResearchSessionId
  try {
    busy.value = true
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
      response_mode: selectedResearchMode === 'quick' ? 'answer' : 'report',
      ...(preferences.provider ? { provider: preferences.provider } : {}),
      ...(preferences.model ? { model: preferences.model } : {}),
      ...(attachmentIds.length ? { attachments: attachmentIds } : {}),
    }, signal.signal, {
      onStatus: (status) => {
        if (status.session_id && status.session_id !== loadedServerSessionId) {
          loadedServerSessionId = status.session_id
          intake.setResearchSessionIdIn(localSessionId, status.session_id)
        }
        intake.patchIn(localSessionId, pendingId, {
          trace: status.agent_trace || [],
          progressUpdates: status.progress_updates || [],
          tools: status.tools || [],
          runStartedAt: status.started_at,
          runCompletedAt: status.completed_at,
        })
      },
    })
    if (data.session_id) intake.setResearchSessionIdIn(localSessionId, data.session_id)
    intake.markServerStartedIn(localSessionId)
    const answerText = data.agent_answer || data.message || ''
    const health = normalizePatientHealthAnswer(data.patient_health, answerText)
    const reportMarkdown = await hydrateRunReport(data, readFormalReport)
    intake.patchIn(localSessionId, pendingId, {
      content: health?.bottom_line || answerText || '这次没有生成回答，请重试。',
      ...(health ? { health } : {}),
      ...(reportMarkdown ? { reportMarkdown } : {}),
      ...(data.report_path ? { reportPath: data.report_path } : {}),
      runId: data.run_id,
      queryId: data.query_id,
      pending: false,
      trace: data.agent_trace || [],
      progressUpdates: data.progress_updates || [],
      tools: data.tools || [],
      runStartedAt: data.started_at,
      runCompletedAt: data.completed_at,
    })
    if (reportMarkdown || data.report_path) {
      expandedReportMessageIds.value.add(pendingId)
      expandedReportMessageIds.value = new Set(expandedReportMessageIds.value)
    }
    if (intake.activeSessionId !== localSessionId || router.currentRoute.value.path !== '/patient/intake') {
      ui.notifyRunCompleted({
        sessionId: localSessionId,
        runId: data.run_id,
        title: intake.sessions.find((session) => session.id === localSessionId)?.title || '健康问答',
        question: text,
        workspace: 'patient',
      })
    }
  } catch (reason) {
    const stopped = reason instanceof DOMException && reason.name === 'AbortError'
    intake.patchIn(localSessionId, userMessageId, { failed: true })
    intake.patchIn(localSessionId, pendingId, {
      pending: false,
      content: stopped
        ? '已停止等待；后端任务可能仍会短暂收尾。'
        : `这次没有连上服务。你写下的内容仍保留在这里，可以稍后再试。${reason instanceof Error ? `（${reason.message}）` : ''}`,
    })
    error.value = reason instanceof Error ? reason.message : '服务暂不可用'
  } finally {
    busy.value = false
    busySignal.value = null
    uploadingAttachments.value = false
  }
}

const stop = () => { busySignal.value?.abort() }
const newQuestion = () => {
  intake.create()
  question.value = ''
  error.value = ''
}
const handlePrimaryAction = () => {
  if (busy.value && !question.value.trim()) { stop(); return }
  void ask()
}
</script>

<template>
  <main class="patient-page" :class="{ 'patient-chat': activeHasConversation }">
    <header class="patient-top">
      <button class="patient-brand" type="button" aria-label="返回入口" @click="router.push('/')"><span>循</span>循医</button>
      <div><small>健康问答 · 日常问题</small><button type="button" @click="router.push('/clinician')">医生入口</button></div>
    </header>
    <div class="patient-workspace">
      <aside class="patient-rail" aria-label="健康问答记录">
        <div class="patient-rail-head">
          <span>问答记录</span>
          <button type="button" :disabled="busy" @click="clearHistory">清空</button>
        </div>
        <button class="patient-rail-new" type="button" @click="newQuestion">＋ 新建健康问答</button>
        <label class="patient-history-search">
          <span class="sr-only">搜索历史问答</span>
          <input v-model="historyQuery" type="search" placeholder="搜索历史问答" />
        </label>
        <nav class="patient-rail-list" aria-label="历史问答">
          <button
            v-for="session in filteredSessions"
            :key="session.id"
            type="button"
            :class="{ active: session.id === intake.activeSessionId }"
            @click="intake.select(session.id)"
          >
            <strong>{{ session.title }}</strong>
            <small>{{ new Date(session.updatedAt).toLocaleDateString('zh-CN') }} · {{ session.messages.filter((m) => m.role === 'user').length }} 问</small>
          </button>
          <p v-if="!filteredSessions.length" class="patient-history-empty">没有匹配的问答记录</p>
        </nav>
        <SiteCredit placement="patient-rail" />
      </aside>
      <div class="patient-center">
        <section v-if="!activeHasConversation" class="hero-dp" aria-label="健康问答">
          <div class="hero-copy">
            <span class="workspace-eyebrow">循医 · HEALTH INFO</span>
            <div class="hero-title">从日常健康疑问，走到可靠的判断。</div>
            <p>用容易理解的方式解答健康问题；答案不替代现场诊疗。最多 {{ PATIENT_FREE_CHAT_TURN_LIMIT }} 轮，每轮都会快速检索可靠信息。</p>
          </div>
        </section>

        <form class="ask-bar" aria-label="健康问题输入区" @submit.prevent="ask()">
          <div class="mode-context" aria-live="polite">
            <strong>日常健康问答</strong>
            <span>{{ modeDescription }}</span>
          </div>
          <div class="composer-body">
            <textarea
              ref="questionInput"
              v-model="question"
              placeholder="输入日常健康问题，例如：最近总睡不好，哪些情况需要去医院看看？"
              aria-label="健康问题"
              :disabled="freeChatComplete"
              @keydown.ctrl.enter.prevent="ask()"
              @keydown.meta.enter.prevent="ask()"
            />
            <div class="attachment-tray" aria-label="本轮附件">
              <input ref="fileInput" type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md" hidden @change="addPendingFiles(($event.target as HTMLInputElement).files, 'document')" />
              <input ref="medicalImageInput" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif" hidden @change="addPendingFiles(($event.target as HTMLInputElement).files, 'medical_image')" />
              <button type="button" :disabled="busy || uploadingAttachments" @click="fileInput?.click()">上传附件</button>
              <button type="button" :disabled="busy || uploadingAttachments" @click="medicalImageInput?.click()">上传医学图像</button>
              <span v-for="(item, index) in pendingUploads" :key="`${item.file.name}-${index}`" class="attachment-chip">
                {{ item.kind === 'medical_image' ? '医学图像 · ' : '' }}{{ item.file.name }}
                <button type="button" aria-label="移除附件" @click="removePendingFile(index)">×</button>
              </span>
              <small v-if="uploadingAttachments">正在上传附件；随后会并行进行 OCR/文字解析…</small>
              <small v-if="attachmentError" class="attachment-error">{{ attachmentError }}</small>
            </div>
          </div>
          <div class="composer-options" aria-label="问答选项">
            <label class="runtime-select">
              <span>服务</span>
              <select v-model="preferences.provider" :disabled="busy || !providers.length">
                <option v-for="item in providers" :key="item.provider" :value="item.provider">{{ item.provider_label }}</option>
              </select>
            </label>
            <label class="runtime-select">
              <span>模型</span>
              <select v-model="preferences.model" :disabled="busy || !modelsForProvider.length">
                <option v-for="item in modelsForProvider" :key="item.model" :value="item.model">{{ item.model_label }}</option>
              </select>
            </label>
            <div class="patient-mode-switch" role="group" aria-label="研究模式">
              <button
                type="button"
                :class="{ active: preferences.researchMode === 'quick' }"
                :aria-pressed="preferences.researchMode === 'quick'"
                :disabled="busy"
                @click="selectResearchMode('quick')"
              >快速</button>
              <button
                type="button"
                :class="{ active: preferences.researchMode === 'expert' }"
                :aria-pressed="preferences.researchMode === 'expert'"
                :disabled="busy"
                @click="selectResearchMode('expert')"
              >专家</button>
            </div>
            <span class="composer-option active" aria-label="信息检索已开启">信息检索已开启</span>
            <span v-if="runtimeConfigError" class="runtime-error">{{ runtimeConfigError }}</span>
          </div>
          <button class="send-button" type="button" :aria-label="primaryActionLabel" @click="handlePrimaryAction">
            <svg v-if="!busy" width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span v-else>■</span>
            <span class="send-label">{{ primaryActionLabel }}</span>
          </button>
        </form>

        <div class="app-desktop-grid">
          <section v-if="!activeHasConversation" class="feature-section" aria-label="日常健康示例">
            <div class="feature-header">
              <span><strong>常见健康问题</strong><small>选择一个示例，也可以自己输入问题</small></span>
            </div>
            <div class="feature-track" aria-label="常见健康问题滑动列表">
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

          <section v-if="activeHasConversation" ref="feed" class="chat-feed" aria-label="健康问答对话">
            <header class="conversation-context">
              <div class="conversation-context-copy">
                <span>健康问答</span>
                <strong>{{ intake.active.title }}</strong>
                <small>第 {{ researchCount }} 问 · 共 {{ intake.userTurnCount }}/{{ PATIENT_FREE_CHAT_TURN_LIMIT }} 轮</small>
              </div>
            </header>
            <article
              v-for="message in intake.active.messages"
              :key="message.id"
              class="chat-message"
              :class="message.role"
            >
              <div class="bubble">
                <div v-if="message.role === 'assistant'" class="message-heading">
                  <strong>循医</strong>
                  <span v-if="message.researchMode" class="message-mode">{{ message.researchMode === 'expert' ? '专家模式' : '快速模式' }}</span>
                </div>
                <RunActivity
                  v-if="message.role === 'assistant'"
                  :trace="message.trace || []"
                  :progress-updates="message.progressUpdates"
                  :tools="message.tools"
                  :pending="message.pending"
                  :started-at="message.runStartedAt"
                  :completed-at="message.runCompletedAt"
                />
                <PatientHealthAnswerView
                  v-if="message.role === 'assistant' && !message.pending && message.health"
                  :answer="message.health"
                />
                <div v-else-if="message.role === 'assistant' && !message.pending" class="markdown-content">
                  <MarkdownContent :markdown="message.content" />
                </div>
                <p v-else>{{ message.content }}</p>
                <section
                  v-if="message.role === 'assistant' && !message.pending && (message.reportMarkdown || message.reportPath)"
                  class="report-attachment patient-report-attachment"
                  aria-label="详细循证报告"
                >
                  <button
                    class="report-attachment-card"
                    type="button"
                    :aria-expanded="expandedReportMessageIds.has(message.id)"
                    @click="toggleReport(message)"
                  >
                    <span class="report-attachment-icon" aria-hidden="true">＋</span>
                    <span class="report-attachment-copy">
                      <strong>详细循证报告</strong>
                      <small>查看研究结论、适用边界和参考文献</small>
                    </span>
                    <span class="report-attachment-action">{{ expandedReportMessageIds.has(message.id) ? '收起' : '展开' }}</span>
                  </button>
                  <section v-if="expandedReportMessageIds.has(message.id)" class="final-report" aria-label="详细循证报告正文">
                    <header class="final-report-head">
                      <div>
                        <span>证据依据</span>
                        <strong>详细循证报告</strong>
                      </div>
                      <small>可点击引用核验原文</small>
                    </header>
                    <ReportRenderer
                      v-if="message.reportMarkdown"
                      :markdown="message.reportMarkdown"
                      audience="patient"
                      @citation="openCitation($event, message.reportPath)"
                    />
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
              <span>可以新建一个健康问答继续提问。</span>
              <button type="button" @click="newQuestion">新建健康问答</button>
            </div>
          </section>
        </div>
      </div>
    </div>
    <RightDetailPanel />
    <RunCompletionNotices />
  </main>
</template>

<style scoped>
.patient-error { margin: 0 0 12px; color: var(--danger); font-size: 13px; }
</style>
