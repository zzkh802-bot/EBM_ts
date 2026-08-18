<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import RunActivity from '../components/evidence/RunActivity.vue'
import MarkdownContent from '../components/report/MarkdownContent.vue'
import SiteCredit from '../components/shell/SiteCredit.vue'
import { agentService, uploadAttachment } from '../services'
import { usePatientIntakeStore, usePreferencesStore } from '../stores'
import { PATIENT_FREE_CHAT_TURN_LIMIT, type RuntimeConfig } from '../types/domain'
import { newId, nowIso } from '../utils/core'

const router = useRouter()
const intake = usePatientIntakeStore()
const preferences = usePreferencesStore()
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

const freeChatComplete = computed(() => intake.userTurnCount >= PATIENT_FREE_CHAT_TURN_LIMIT)
const hasConversation = computed(() => intake.active.messages.some((message) => message.role === 'user'))
const activeHasConversation = computed(() => intake.active.messages.some((message) => message.role === 'user'))
const researchCount = computed(() => intake.active.messages.filter((message) => message.role === 'user').length)
const availableModels = computed(() => runtimeConfig.value?.models.filter((item) => item.available && !item.connection_provider) || [])
const providers = computed(() => availableModels.value.filter((item, index, items) =>
  items.findIndex((candidate) => candidate.provider === item.provider) === index,
))
const modelsForProvider = computed(() => availableModels.value.filter((item) => item.provider === preferences.provider))
const primaryActionLabel = computed(() => {
  if (!busy.value) return '提问'
  return question.value.trim() ? '加入后续追问' : '停止本轮问答'
})

watch(() => intake.activeSessionId, () => {
  question.value = ''
  error.value = ''
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
  feed.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' })
}
watch(() => intake.active.messages.length, () => { void scrollToLatest() })

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

const focusQuestion = async () => {
  await nextTick()
  questionInput.value?.focus()
}
const selectExample = async (value: string) => {
  question.value = value
  await focusQuestion()
}

const ask = async () => {
  const text = question.value.trim()
  if (!text || busy.value || freeChatComplete.value) return
  error.value = ''
  const localSessionId = intake.activeSessionId
  if (!hasConversation.value) { question.value = '' } else { /* 追问沿用当前会话 */ }
  question.value = ''
  intake.add({ id: newId('patient-user'), role: 'user', content: text, createdAt: nowIso() })
  const pendingId = newId('patient-assistant')
  intake.add({
    id: pendingId, role: 'assistant', content: '正在检索并整理可靠信息，请稍候…',
    createdAt: nowIso(), pending: true, trace: [], tools: [],
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
    intake.patch(pendingId, { runStartedAt: nowIso() })
    const data = await agentService.run({
      question: text,
      ...(requestResearchSessionId ? { session_id: requestResearchSessionId } : {}),
      audience_mode: 'patient', thinking_level: 'low', research_mode: 'quick', search_enabled: true, response_mode: 'answer',
      ...(preferences.provider ? { provider: preferences.provider } : {}),
      ...(preferences.model ? { model: preferences.model } : {}),
      ...(attachmentIds.length ? { attachments: attachmentIds } : {}),
    }, signal.signal, {
      onStatus: (status) => {
        if (status.session_id && status.session_id !== loadedServerSessionId) {
          loadedServerSessionId = status.session_id
          intake.setResearchSessionId(status.session_id)
        }
        intake.patch(pendingId, {
          trace: status.agent_trace || [],
          progressUpdates: status.progress_updates || [],
          tools: status.tools || [],
          runStartedAt: status.started_at,
          runCompletedAt: status.completed_at,
        })
      },
    })
    if (data.session_id) intake.setResearchSessionId(data.session_id)
    intake.markServerStarted()
    intake.patch(pendingId, {
      content: data.agent_answer || data.message || '这次没有生成回答，请重试。', pending: false,
      trace: data.agent_trace || [],
      progressUpdates: data.progress_updates || [],
      tools: data.tools || [],
      runStartedAt: data.started_at,
      runCompletedAt: data.completed_at,
    })
  } catch (reason) {
    const stopped = reason instanceof DOMException && reason.name === 'AbortError'
    intake.patch(pendingId, {
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
        </div>
        <button class="patient-rail-new" type="button" @click="newQuestion">＋ 新建健康问答</button>
        <nav class="patient-rail-list" aria-label="历史问答">
          <button
            v-for="session in intake.sessions"
            :key="session.id"
            type="button"
            :class="{ active: session.id === intake.activeSessionId }"
            @click="intake.select(session.id)"
          >
            <strong>{{ session.title }}</strong>
            <small>{{ new Date(session.updatedAt).toLocaleDateString('zh-CN') }} · {{ session.messages.filter((m) => m.role === 'user').length }} 问</small>
          </button>
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
            <span>快速模式：低推理、快速检索，直接输出容易理解的回答。</span>
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
            <span class="composer-option active" aria-label="信息检索已开启">信息检索已开启</span>
            <span class="composer-option" aria-label="快速模式">快速模式</span>
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
                <div v-if="message.role === 'assistant' && !message.pending" class="markdown-content">
                  <MarkdownContent :markdown="message.content" />
                </div>
                <p v-else>{{ message.content }}</p>
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
  </main>
</template>

<style scoped>
.patient-error { margin: 0 0 12px; color: var(--danger); font-size: 13px; }
</style>