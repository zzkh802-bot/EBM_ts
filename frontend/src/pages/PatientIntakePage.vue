<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PatientProfileDialog from '../components/patient/PatientProfileDialog.vue'
import PatientReportView from '../components/patient/PatientReportView.vue'
import PatientSessionRail from '../components/patient/PatientSessionRail.vue'
import { patientIntakeService, type IntakeRequest } from '../services'
import { usePatientIntakeStore } from '../stores'
import { PATIENT_FREE_CHAT_TURN_LIMIT, type PatientProfile } from '../types/domain'
import { copyText } from '../utils/browser'
import { newId, nowIso } from '../utils/core'

const router = useRouter()
const intake = usePatientIntakeStore()
const draft = ref('')
const busy = ref(false)
const error = ref('')
const feed = ref<HTMLElement | null>(null)
const profileDialogOpen = ref(false)

const freeChat = computed(() => intake.active.mode === 'free_chat')
const freeChatComplete = computed(() => freeChat.value && intake.userTurnCount >= PATIENT_FREE_CHAT_TURN_LIMIT)
const pageTitle = computed(() => freeChat.value ? '问一个简单的健康问题。' : '把想说的，慢慢说清楚。')
const pageSubtitle = computed(() => freeChat.value
  ? `这个窗口不读取档案、不生成病例，${PATIENT_FREE_CHAT_TURN_LIMIT} 轮后自动结束。`
  : '不需要使用医学术语；不确定的地方也可以如实说。')

const profilePayload = (): IntakeRequest['profile'] => {
  const profile = intake.activeProfile
  return profile ? {
    id: profile.id, revision: profile.updatedAt, name: profile.name, sex: profile.sex,
    ...(profile.age === undefined ? {} : { age: profile.age }), allergies: profile.allergies,
    pregnancy: profile.pregnancy, memory: profile.memory,
  } : undefined
}
const requestBody = (message: string): IntakeRequest => {
  const profile = profilePayload()
  return {
    message, client_session_id: intake.active.id, mode: intake.active.mode, thinking_enabled: intake.active.thinkingEnabled,
    ...(profile ? { profile } : {}),
  }
}

const scrollToLatest = async () => {
  await nextTick()
  feed.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' })
}
watch(() => intake.active.messages.length, () => { void scrollToLatest() })
watch(() => intake.activeSessionId, () => {
  draft.value = ''
  error.value = ''
  if (intake.active.mode === 'visit_preparation' && !intake.activeProfile) profileDialogOpen.value = true
})
onMounted(() => { if (!intake.activeProfile && !freeChat.value) profileDialogOpen.value = true })

const ask = async () => {
  const message = draft.value.trim()
  if (!message || busy.value || freeChatComplete.value) return
  if (!freeChat.value && !intake.activeProfile) { profileDialogOpen.value = true; return }
  error.value = ''
  const userId = newId('patient-user')
  intake.add({ id: userId, role: 'user', content: message, createdAt: nowIso() })
  draft.value = ''
  const pendingId = newId('patient-assistant')
  intake.add({ id: pendingId, role: 'assistant', content: '我在认真看你刚才说的内容…', createdAt: nowIso(), pending: true })
  busy.value = true
  try {
    const result = await patientIntakeService.message(requestBody(message))
    intake.markServerStarted()
    intake.patch(pendingId, { content: result.reply, pending: false })
  } catch (reason) {
    intake.patch(userId, { failed: true })
    intake.patch(pendingId, { content: '这次没有连上服务。你写下的内容仍保留在这里，可以稍后再试。', pending: false })
    error.value = reason instanceof Error ? reason.message : '服务暂不可用'
  } finally {
    busy.value = false
  }
}

const makeSummary = async () => {
  if (busy.value || freeChat.value || !intake.active.serverStarted || !intake.activeProfile) return
  busy.value = true
  error.value = ''
  try {
    const result = await patientIntakeService.summary(requestBody('请整理本次就诊说明'))
    intake.setSummary(result.reply, result.report_path)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '暂时无法整理说明'
  } finally {
    busy.value = false
  }
}

const openProfile = (profileId: string) => {
  if (!intake.assignProfile(profileId)) intake.create('visit_preparation', profileId)
}
const chooseProfile = (profileId: string) => {
  openProfile(profileId)
  profileDialogOpen.value = false
}
const saveProfile = (value: Omit<PatientProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
  const profile = intake.saveProfile(value)
  openProfile(profile.id)
  profileDialogOpen.value = false
}
const newVisit = () => {
  intake.create('visit_preparation', intake.activeProfile?.id || null)
  if (!intake.activeProfile) profileDialogOpen.value = true
}
const newFreeChat = () => intake.create('free_chat')
</script>

<template>
  <main class="patient-page">
    <header class="patient-top">
      <button class="patient-brand" type="button" aria-label="返回入口" @click="router.push('/')"><span>循</span>循医</button>
      <div><small>{{ freeChat ? '健康自由问答' : '就诊前准备' }}</small><button type="button" @click="router.push('/clinician')">医生入口</button></div>
    </header>
    <div class="patient-layout" :class="{ 'free-chat': freeChat }">
      <PatientSessionRail :busy="busy" @profile="profileDialogOpen = true" @new-visit="newVisit" @free-chat="newFreeChat" />
      <section class="patient-conversation" aria-label="患者对话">
        <header class="patient-intro">
          <p>{{ freeChat ? `无记忆问答 · ${intake.userTurnCount}/${PATIENT_FREE_CHAT_TURN_LIMIT} 轮` : `就诊准备 · ${intake.activeProfile?.name || '待选择档案'}` }}</p>
          <h1>{{ pageTitle }}</h1>
          <span>{{ pageSubtitle }}</span>
          <button class="patient-thinking-toggle" type="button" :aria-pressed="intake.active.thinkingEnabled" :disabled="busy" @click="intake.setThinkingEnabled(!intake.active.thinkingEnabled)">
            思考 {{ intake.active.thinkingEnabled ? 'medium' : '关闭' }}
          </button>
        </header>
        <div ref="feed" class="patient-feed">
          <article v-for="message in intake.active.messages" :key="message.id" class="patient-message" :class="message.role">
            <span v-if="message.role === 'assistant'" class="patient-speaker">循医</span>
            <p :class="{ pending: message.pending }">{{ message.content }}</p>
          </article>
        </div>
        <p v-if="error" class="patient-error">{{ error }}</p>
        <div v-if="freeChatComplete" class="free-chat-finished">
          <strong>本次 {{ PATIENT_FREE_CHAT_TURN_LIMIT }} 轮问答已结束</strong><span>这段内容不会写入任何档案。需要继续时，可以新建一个自由问答窗口。</span><button type="button" @click="newFreeChat">新建自由问答</button>
        </div>
        <form v-else class="patient-composer" @submit.prevent="ask">
          <textarea v-model="draft" :disabled="busy" :placeholder="freeChat ? '例如：家里有人流鼻血，第一步应该怎么做？' : '例如：我最近总觉得胸口闷，不太知道该怎么和医生说…'" aria-label="输入内容" @keydown.ctrl.enter.prevent="ask" />
          <footer>
            <span>{{ freeChat ? '回答不保存到档案；不能替代现场诊疗。' : '原话保留在这次准备中；档案记忆由你确认。' }}</span>
            <button type="submit" :disabled="busy || !draft.trim()">{{ busy ? '整理中…' : freeChat ? '提问' : '继续说' }}</button>
          </footer>
        </form>
      </section>
      <aside v-if="!freeChat" class="patient-note" aria-label="就诊说明">
        <header><span>给医生的就诊说明</span><button type="button" @click="newVisit">新建</button></header>
        <template v-if="intake.active.visitSummary">
          <PatientReportView :markdown="intake.active.visitSummary" />
          <small v-if="intake.active.reportPath">已归档保存</small>
          <footer><button type="button" @click="copyText(intake.active.visitSummary || '')">复制说明</button></footer>
        </template>
        <template v-else>
          <p>在你讲得差不多时，把内容整理成一份清楚、可核对并会保存到本次档案的说明。</p>
          <button class="summary-button" type="button" :disabled="busy || !intake.active.serverStarted" @click="makeSummary">整理并保存就诊说明</button>
          <small v-if="!intake.active.serverStarted">先告诉我这次最想和医生说什么。</small>
        </template>
      </aside>
      <aside v-else class="free-chat-note">
        <strong>这个窗口不会留下什么</strong>
        <p>不读取任何人的档案，不写入长期记忆，也不生成就诊报告。每个窗口最多 {{ PATIENT_FREE_CHAT_TURN_LIMIT }} 轮。</p>
      </aside>
    </div>
    <PatientProfileDialog :open="profileDialogOpen" :profiles="intake.profiles" :selected-id="intake.active.profileId" @close="profileDialogOpen = false" @select="chooseProfile" @save="saveProfile" />
  </main>
</template>
