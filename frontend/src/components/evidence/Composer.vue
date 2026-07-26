<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AttachmentData } from '../../types/domain'

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const props = defineProps<{ modelValue: string; attachments: AttachmentData[]; queue: string[]; busy: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  files: [files: FileList | null]
  removeAttachment: [index: number]
  submit: []
  runQueued: [index: number]
  removeQueued: [index: number]
}>()
const input = ref<HTMLInputElement | null>(null)
const listening = ref(false)
const speechConstructor = computed(() => {
  const host = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return host.SpeechRecognition || host.webkitSpeechRecognition
})
const startVoice = () => {
  if (!speechConstructor.value) { window.alert('当前浏览器不支持语音输入'); return }
  const recognition = new speechConstructor.value()
  recognition.lang = 'zh-CN'; recognition.interimResults = false
  recognition.onresult = (event) => emit('update:modelValue', `${props.modelValue}${event.results[0][0].transcript}`)
  recognition.onerror = recognition.onend = () => { listening.value = false }
  listening.value = true
  recognition.start()
}
</script>

<template>
  <div class="composer-zone">
    <div v-if="queue.length" class="queue-tray">
      <span v-for="(item, index) in queue" :key="`${item}-${index}`">{{ item }}<button :disabled="busy" @click="emit('runQueued', index)">发送</button><button @click="emit('removeQueued', index)">×</button></span>
    </div>
    <div v-if="attachments.length" class="attachment-row"><span v-for="(file, index) in attachments" :key="file.id">📎 {{ file.name }} <button @click="emit('removeAttachment', index)">×</button></span></div>
    <div class="composer">
      <button class="attach-button" aria-label="上传附件" @click="input?.click()">＋</button>
      <input ref="input" hidden type="file" multiple @change="emit('files', ($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">
      <button class="voice-button" :class="{ listening }" :disabled="!speechConstructor" :title="speechConstructor ? '语音输入' : '当前浏览器不支持语音输入'" @click="startVoice">◉</button>
      <textarea :value="modelValue" rows="2" placeholder="输入医学问题，Ctrl/Cmd + Enter 发送…" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" @keydown.ctrl.enter.prevent="emit('submit')" @keydown.meta.enter.prevent="emit('submit')" />
      <button class="send-button" :class="{ stop: busy }" @click="emit('submit')">{{ busy ? '■' : '↑' }}</button>
    </div>
    <small>AI 结果用于循证辅助，不替代临床判断。附件单个不超过 8MB。</small>
  </div>
</template>
