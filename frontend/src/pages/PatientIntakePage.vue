<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { patientIntakeService } from '../services'
import { usePatientIntakeStore } from '../stores'
import { copyText } from '../utils/browser'
import { newId, nowIso } from '../utils/core'

const router = useRouter()
const intake = usePatientIntakeStore()
const draft = ref('')
const busy = ref(false)
const error = ref('')
const feed = ref<HTMLElement | null>(null)

const scrollToLatest = async () => {
  await nextTick()
  feed.value?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' })
}
watch(() => intake.active.messages.length, () => { void scrollToLatest() })

const ask = async () => {
  const message = draft.value.trim()
  if (!message || busy.value) return
  error.value = ''
  intake.add({ id: newId('patient-user'), role: 'user', content: message, createdAt: nowIso() })
  draft.value = ''
  const pendingId = newId('patient-assistant')
  intake.add({ id: pendingId, role: 'assistant', content: '我在认真整理你刚才说的内容…', createdAt: nowIso(), pending: true })
  busy.value = true
  try {
    const result = await patientIntakeService.message({ message, ...(intake.active.remoteSessionId ? { session_id: intake.active.remoteSessionId } : {}) })
    intake.setRemoteSessionId(result.session_id)
    intake.patch(pendingId, { content: result.reply, pending: false })
  } catch (reason) {
    intake.patch(pendingId, { content: '这次没有连上就诊准备服务。你写下的内容仍保留在这里，可以稍后再试。', pending: false })
    error.value = reason instanceof Error ? reason.message : '服务暂不可用'
  } finally {
    busy.value = false
  }
}

const makeSummary = async () => {
  if (busy.value || !intake.active.remoteSessionId) return
  busy.value = true
  error.value = ''
  try {
    const result = await patientIntakeService.summary({ message: '请整理本次就诊说明', session_id: intake.active.remoteSessionId })
    intake.setRemoteSessionId(result.session_id)
    intake.setSummary(result.reply)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '暂时无法整理说明'
  } finally {
    busy.value = false
  }
}

const newIntake = () => { intake.create(); draft.value = ''; error.value = '' }
</script>

<template>
  <main class="patient-page">
    <header class="patient-top">
      <button class="patient-brand" type="button" aria-label="返回入口" @click="router.push('/')"><span>循</span>循医</button>
      <div><small>就诊前准备</small><button type="button" @click="router.push('/clinician/evidence')">医生入口</button></div>
    </header>
    <div class="patient-layout" :class="{ 'has-summary': Boolean(intake.active.visitSummary) }">
      <section class="patient-conversation" aria-label="就诊准备对话">
        <header class="patient-intro">
          <p>就诊准备</p>
          <h1>把想说的，慢慢说清楚。</h1>
          <span>不需要使用医学术语；不确定的地方也可以如实说。</span>
        </header>
        <div ref="feed" class="patient-feed">
          <article v-for="message in intake.active.messages" :key="message.id" class="patient-message" :class="message.role">
            <span v-if="message.role === 'assistant'" class="patient-speaker">循医</span>
            <p :class="{ pending: message.pending }">{{ message.content }}</p>
          </article>
        </div>
        <p v-if="error" class="patient-error">{{ error }}</p>
        <form class="patient-composer" @submit.prevent="ask">
          <textarea v-model="draft" :disabled="busy" placeholder="例如：我最近总觉得胸口闷，不太知道该怎么和医生说…" aria-label="描述这次想就医的情况" @keydown.ctrl.enter.prevent="ask" />
          <footer>
            <span>可随时修改；你的原话会保留在这次准备中。</span>
            <button type="submit" :disabled="busy || !draft.trim()">{{ busy ? '整理中…' : '继续说' }}</button>
          </footer>
        </form>
      </section>
      <aside class="patient-note" aria-label="就诊说明">
        <header><span>给医生的就诊说明</span><button type="button" @click="newIntake">重新开始</button></header>
        <template v-if="intake.active.visitSummary">
          <pre>{{ intake.active.visitSummary }}</pre>
          <footer><button type="button" @click="copyText(intake.active.visitSummary || '')">复制说明</button></footer>
        </template>
        <template v-else>
          <p>在你讲得差不多时，把内容整理成一份清楚、可核对的说明。</p>
          <button class="summary-button" type="button" :disabled="busy || !intake.active.remoteSessionId" @click="makeSummary">整理就诊说明</button>
          <small v-if="!intake.active.remoteSessionId">先告诉我这次最想和医生说什么。</small>
        </template>
      </aside>
    </div>
  </main>
</template>
