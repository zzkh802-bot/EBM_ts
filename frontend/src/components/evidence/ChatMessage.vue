<script setup lang="ts">
import type { Message } from '../../types/domain'
import type { Reference } from '../../utils/report'
import ReportRenderer from '../report/ReportRenderer.vue'

defineProps<{ message: Message; currentStage: string }>()
const emit = defineEmits<{
  citation: [reference: Reference]
  action: [name: 'copy' | 'speak' | 'share' | 'retry' | 'simplify' | 'detail' | 'up' | 'down' | 'markdown' | 'archive', message: Message]
}>()
</script>

<template>
  <article class="message" :class="message.role">
    <header><strong>{{ message.title }}</strong><small v-if="message.role === 'assistant'">{{ message.audienceMode === 'public' ? '普通用户版' : '医生专业版' }} · {{ message.researchMode }}</small></header>
    <div v-if="message.pending" class="agent-stage"><span class="spinner" />{{ currentStage }}<small>正在执行可审计的循证工作流</small></div>
    <ReportRenderer v-else-if="message.role === 'assistant' && !message.showMarkdown" :markdown="message.content" :audience="message.audienceMode" :research-mode="message.researchMode" @citation="emit('citation', $event)" />
    <pre v-else-if="message.showMarkdown && message.audienceMode === 'clinician'">{{ message.content }}</pre>
    <p v-else>{{ message.content }}</p>
    <div v-if="message.attachments?.length" class="attachment-row"><span v-for="file in message.attachments" :key="file.id">📎 {{ file.name }}</span></div>
    <footer v-if="message.role === 'assistant' && !message.pending" class="message-actions">
      <button @click="emit('action', 'copy', message)">复制</button><button @click="emit('action', 'speak', message)">朗读</button><button @click="emit('action', 'share', message)">分享</button>
      <button @click="emit('action', 'retry', message)">重试</button><button @click="emit('action', 'simplify', message)">简化</button><button @click="emit('action', 'detail', message)">详细</button>
      <button :class="{ active: message.feedback === 'up' }" @click="emit('action', 'up', message)">有帮助</button><button :class="{ active: message.feedback === 'down' }" @click="emit('action', 'down', message)">需改进</button>
      <button v-if="message.audienceMode === 'clinician'" @click="emit('action', 'markdown', message)">Markdown</button>
      <button v-if="message.archive" @click="emit('action', 'archive', message)">查看档案</button>
    </footer>
  </article>
</template>
