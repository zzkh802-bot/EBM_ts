<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { agentService, archiveService } from '../services'
import { useAgentRunStore, usePreferencesStore, useSessionsStore, useUiStore } from '../stores'
import type { AccountConnection, Message, ModeSnapshot, RuntimeConfig } from '../types/domain'
import { buildAgentRequest, newId, nowIso, responseText } from '../utils/core'
import { parseReport, projectReport, reportPlainText, type Reference } from '../utils/report'
import { copyText } from '../utils/browser'
import ReportRenderer from '../components/report/ReportRenderer.vue'
import RunActivity from '../components/evidence/RunActivity.vue'
import { goodCases } from '../data/goodCases'

const preferences = usePreferencesStore()
const sessions = useSessionsStore()
const run = useAgentRunStore()
const ui = useUiStore()
const question = ref('')
const feed = ref<HTMLElement | null>(null)
const runtimeConfig = ref<RuntimeConfig | null>(null)
const runtimeConfigError = ref('')
const accountConnection = ref<AccountConnection | null>(null)
const connectionInput = ref('')
let connectionTimer: number | undefined
const stages = {
  planning: '正在梳理问题与检索范围', retrieving: '正在检索可用证据', tooling: '正在阅读与核验资料',
  generating: '正在生成正式循证报告', network_wait: '正在等待研究服务响应', idle: '',
}
watch(() => sessions.activeSessionId, () => {
  question.value = ''
  run.queuedGuidance = []
})

const availableModels = computed(() => runtimeConfig.value?.models.filter((item) => item.available) || [])
const providers = computed(() => availableModels.value.filter((item, index, items) =>
  items.findIndex((candidate) => candidate.provider === item.provider) === index,
))
const modelsForProvider = computed(() => availableModels.value.filter((item) => item.provider === preferences.provider))
const connectableProviders = computed(() => runtimeConfig.value?.models.filter((item) => !item.available && item.connection_provider) || [])
const questionInput = ref<HTMLTextAreaElement | null>(null)
const researchModeLabel = (mode: ModeSnapshot['researchMode']) => mode === 'expert' ? '专家' : '快速'
const audienceModeLabel = (mode: ModeSnapshot['audienceMode']) => mode === 'public' ? '普通用户版' : '医生专业版'
const modeSummary = computed(() => preferences.researchMode === 'expert'
  ? '专家模式会进行更完整的检索、核验与正式报告生成。'
  : '快速模式聚焦关键结论与直接支持它的证据。')
const primaryActionLabel = computed(() => {
  if (!run.busy) return '开始研究'
  return question.value.trim() ? '加入后续追问' : '停止本轮研究'
})
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
onBeforeUnmount(() => { if (connectionTimer) window.clearInterval(connectionTimer) })

const refreshRuntimeConfig = async () => {
  runtimeConfig.value = await agentService.getRuntimeConfig()
  preferences.applyRuntimeConfig(runtimeConfig.value)
}
const stopConnectionPolling = () => {
  if (connectionTimer) window.clearInterval(connectionTimer)
  connectionTimer = undefined
}
const refreshConnection = async () => {
  if (!accountConnection.value) return
  try {
    accountConnection.value = await agentService.getAccountConnection(accountConnection.value.id)
    if (accountConnection.value.status !== 'waiting') {
      stopConnectionPolling()
      if (accountConnection.value.status === 'connected') await refreshRuntimeConfig()
    }
  } catch (error) {
    accountConnection.value = { ...accountConnection.value, status: 'failed', message: error instanceof Error ? error.message : '无法读取账户连接状态' }
    stopConnectionPolling()
  }
}
const connectAccount = async (provider: string) => {
  if (provider !== 'openai-codex' && provider !== 'anthropic') return
  try {
    stopConnectionPolling()
    accountConnection.value = await agentService.startAccountConnection(provider)
    connectionInput.value = ''
    connectionTimer = window.setInterval(() => { void refreshConnection() }, 1_500)
  } catch (error) {
    accountConnection.value = { id: '', provider, status: 'failed', message: error instanceof Error ? error.message : '无法启动账户连接' }
  }
}
const submitConnectionInput = async (value = connectionInput.value) => {
  if (!accountConnection.value || !value.trim()) return
  accountConnection.value = await agentService.respondAccountConnection(accountConnection.value.id, value.trim())
  connectionInput.value = ''
}
const cancelConnection = async () => {
  if (!accountConnection.value?.id) return
  accountConnection.value = await agentService.cancelAccountConnection(accountConnection.value.id)
  stopConnectionPolling()
}

watch(() => sessions.active.messages.length, async () => {
  await nextTick()
  feed.value?.scrollTo({ top: feed.value.scrollHeight, behavior: 'smooth' })
})

const backendInstruction = '请统一使用中文回答。遵循“检索-核验-合成”，每条关键医学判断给出直接支持的引用编号；如有急症或红旗风险先做安全分层。'

async function submit(input = question.value, modeOverride?: ModeSnapshot) {
  const text = input.trim()
  if (run.busy) {
    if (text) { run.queuedGuidance.push(text); question.value = '' }
    else run.stop()
    return
  }
  if (!text) return
  question.value = ''
  const mode = modeOverride || { ...preferences.snapshot }
  sessions.titleFromQuestion(text)
  sessions.addMessage({
    id: newId('msg'), role: 'user', title: '你', content: text, trace: [],
    createdAt: nowIso(), ...mode,
  })
  const pendingId = newId('msg')
  sessions.addMessage({
    id: pendingId, role: 'assistant', title: '循医',
    content: '正在梳理问题与检索范围…', trace: [], tools: [],
    sourceQuestion: text, pending: true, stage: 'planning', createdAt: nowIso(), ...mode,
  })
  const signal = run.start()
  try {
    const dto = buildAgentRequest(
      text,
      `${backendInstruction}\n\n${text}`,
      [],
      '',
      mode,
    )
    const data = await agentService.runV2(dto, signal, {
          sessionId: sessions.active.v2SessionId || undefined,
          provider: preferences.provider || undefined,
          model: preferences.model || undefined,
          onStatus: (status) => {
            if (status.status === 'queued') run.setStage('planning')
            if (status.status === 'running') {
              const activeTool = status.tools?.some((item) => item.status === 'running')
              const reportStarted = status.tools?.some((item) => item.name === 'report_write' || item.name === 'report_finalize')
              run.setStage(activeTool ? 'tooling' : reportStarted ? 'generating' : 'retrieving')
            }
            if (status.status === 'cancelling') run.setStage('network_wait')
            sessions.patchMessage(pendingId, { trace: status.agent_trace || [], tools: status.tools || [] })
          },
          onNetworkRetry: () => { run.setStage('network_wait') },
        })
    sessions.active.v2SessionId = data.session_id || sessions.active.v2SessionId
    sessions.patchMessage(pendingId, {
      pending: false, stage: 'idle', content: responseText(data), trace: data.agent_trace || [],
      tools: data.tools || [],
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
  if (navigator.share) await navigator.share({ title: '循医循证报告', text })
  else await copyText(text)
}
const retry = (message: Message, detail = '') => submit(`${detail}${message.sourceQuestion || ''}`, {
  researchMode: message.researchMode, audienceMode: message.audienceMode,
  deepThink: message.deepThink, searchEnabled: message.searchEnabled,
})
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
const toggleDeepThink = () => { if (!run.busy) preferences.deepThink = !preferences.deepThink }
const toggleSearch = () => { if (!run.busy) preferences.searchEnabled = !preferences.searchEnabled }
</script>

<template>
  <div class="workspace-layout">
    <div class="workspace-center">
      <section class="hero-dp" aria-label="循医工作台">
        <div>
          <div class="hero-title">今天想查询什么医学问题？</div>
          <p>基于文献、指南与临床证据，生成可追溯的循证分析。</p>
        </div>
      </section>

      <form class="ask-bar" aria-label="循医输入区" @submit.prevent="submit()">
        <div class="mode-toolbar" aria-label="回答模式">
          <div class="mode-group">
            <span class="mode-group-label">工作模式</span>
            <fieldset class="mode-segment">
              <legend class="sr-only">循证工作模式</legend>
              <button class="mode-button" :class="{ active: preferences.researchMode === 'instant' }" type="button" :aria-pressed="preferences.researchMode === 'instant'" :disabled="run.busy" @click="preferences.setResearchMode('instant')">快速</button>
              <button class="mode-button" :class="{ active: preferences.researchMode === 'expert' }" type="button" :aria-pressed="preferences.researchMode === 'expert'" :disabled="run.busy" @click="preferences.setResearchMode('expert')">专家</button>
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
        <div class="mode-context" aria-live="polite">
          <strong>{{ researchModeLabel(preferences.researchMode) }}模式</strong>
          <span>{{ modeSummary }}</span>
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
          <button class="composer-option" type="button" :aria-pressed="preferences.deepThink" :class="{ active: preferences.deepThink }" :disabled="run.busy" @click="toggleDeepThink">深度思考</button>
          <button class="composer-option" type="button" :aria-pressed="preferences.searchEnabled" :class="{ active: preferences.searchEnabled }" :disabled="run.busy" @click="toggleSearch">证据检索</button>
          <span v-if="runtimeConfigError" class="runtime-error">{{ runtimeConfigError }}</span>
        </div>
        <button class="send-button" :class="{ 'queue-mode': run.busy && question.trim() }" type="button" :aria-label="primaryActionLabel" @click="handlePrimaryAction">
          <svg v-if="!run.busy" width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span v-else-if="question.trim()" aria-hidden="true">＋</span>
          <span v-else>■</span>
        </button>
      </form>

      <div class="app-desktop-grid">
        <section class="feature-section" aria-label="循医场景">
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

        <section ref="feed" class="chat-feed" aria-label="循医对话">
          <article
            v-for="message in sessions.active.messages"
            :key="message.id"
            class="chat-message"
            :class="message.role"
          >
            <div class="bubble">
              <div class="message-heading">
                <strong>{{ message.title }}</strong>
                <span v-if="message.role === 'assistant'" class="message-mode">{{ researchModeLabel(message.researchMode) }} · {{ audienceModeLabel(message.audienceMode) }}</span>
              </div>
              <div v-if="message.pending" class="agent-stage">{{ stages[run.stage] || '正在调用循证引擎…' }}</div>
              <RunActivity v-if="message.role === 'assistant'" :trace="message.trace" :tools="message.tools" :pending="message.pending" />
              <ReportRenderer
                v-if="message.role === 'assistant' && !message.pending && !message.showMarkdown"
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
                    <button v-if="message.audienceMode === 'clinician'" type="button" @click="sessions.patchMessage(message.id, { showMarkdown: !message.showMarkdown })">查看 Markdown</button>
                    <button v-if="message.archive" type="button" @click="openArchive(message)">查看档案</button>
                  </div>
                </details>
              </div>
            </div>
          </article>
        </section>
      </div>

    </div>

    <aside class="workspace-info-panel" aria-label="工作台信息">
      <section class="workspace-info-card evidence-status-card">
        <div class="workspace-info-title">
          <span>运行状态</span>
          <span class="workspace-live"><i />{{ runtimeConfigError ? '配置异常' : '已连接' }}</span>
        </div>
        <strong>{{ runtimeConfig ? '服务器配置已读取' : '正在读取服务器配置' }}</strong>
        <div class="evidence-source-list">
          <div><span>服务</span><small>{{ providers.find((item) => item.provider === preferences.provider)?.provider_label || '未选择' }}</small></div>
          <div><span>模型</span><small>{{ modelsForProvider.find((item) => item.model === preferences.model)?.model_label || '使用服务器默认值' }}</small></div>
          <div><span>检索</span><small>{{ preferences.searchEnabled ? '按需调用证据工具' : '仅使用当前会话材料' }}</small></div>
        </div>
      </section>
      <section v-if="connectableProviders.length" class="workspace-info-card account-connect-card">
        <div class="workspace-info-title"><span>连接账户</span></div>
        <p>连接订阅账户后，可直接在模型选择器中使用。</p>
        <button
          v-for="item in connectableProviders"
          :key="item.connection_provider"
          class="account-connect-button"
          type="button"
          :disabled="accountConnection?.status === 'waiting'"
          @click="connectAccount(item.connection_provider || '')"
        >连接 {{ item.provider_label }}</button>
      </section>
      <section v-if="accountConnection" class="workspace-info-card account-connect-card" aria-live="polite">
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
          <div><span>研究模式</span><strong>{{ researchModeLabel(preferences.researchMode) }}</strong></div>
          <div><span>深度思考</span><strong>{{ preferences.deepThink ? '开启' : '关闭' }}</strong></div>
          <div><span>证据检索</span><strong :class="{ 'mode-on': preferences.searchEnabled }">{{ preferences.searchEnabled ? '开启' : '关闭' }}</strong></div>
          <div><span>回答对象</span><strong>{{ audienceModeLabel(preferences.audienceMode) }}</strong></div>
        </div>
      </section>
      <div class="workspace-trust-note">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>AI 结果用于循证辅助，不替代医生诊断与临床决策。</span>
      </div>
    </aside>
  </div>
</template>
