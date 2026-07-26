<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { Message } from '../../types/domain'
import type { Reference } from '../../utils/report'
import ChatMessage from './ChatMessage.vue'
const props = defineProps<{ messages: Message[]; stage: string }>()
const emit = defineEmits<{
  citation: [reference: Reference]
  action: [name: 'copy' | 'speak' | 'share' | 'retry' | 'simplify' | 'detail' | 'up' | 'down' | 'markdown' | 'archive', message: Message]
}>()
const feed = ref<HTMLElement | null>(null)
watch(() => props.messages.length, async () => {
  await nextTick()
  feed.value?.scrollTo({ top: feed.value.scrollHeight, behavior: 'smooth' })
})
</script>

<template>
  <div ref="feed" class="chat-feed">
    <ChatMessage v-for="message in messages" :key="message.id" :message="message" :current-stage="stage" @citation="emit('citation', $event)" @action="(name, item) => emit('action', name, item)" />
  </div>
</template>
