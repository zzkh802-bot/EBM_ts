<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ResearchProgressUpdate, TraceItem } from '../../types/domain'

const props = defineProps<{
  trace: TraceItem[]
  progressUpdates?: ResearchProgressUpdate[]
  tools?: Array<Record<string, unknown>>
  pending?: boolean
  startedAt?: string
  completedAt?: string
}>()

const currentTime = ref(Date.now())
let clock: number | undefined

onMounted(() => {
  clock = window.setInterval(() => { currentTime.value = Date.now() }, 1_000)
})
onUnmounted(() => {
  if (clock) window.clearInterval(clock)
})

const toolLabels: Record<string, string> = {
  guideline_mcp_search: '检索临床指南',
  guideline_mcp_retrieve: '定位指南章节',
  guideline_mcp_read: '阅读指南原文',
  source_library_search: '检索本地资料库',
  pubmed_search: '检索医学文献',
  pubmed_read: '阅读文献原文',
  pubmed_similar: '扩展相似文献',
  web_search: '检索公开资料',
  web_read: '阅读来源原文',
  evidence_add: '登记关键证据',
  evidence_read: '复核已登记证据',
  evidence_list: '核对证据清单',
  research_frame_init: '建立研究框架',
  research_frame_update: '更新研究框架',
  research_frame_scratchpad_append: '记录研究判断',
  report_write: '生成正式报告',
  report_finalize: '核验并发布报告',
  read: '读取研究材料',
}

const parseTime = (value?: string) => {
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : undefined
}

const formatDuration = (milliseconds?: number) => {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} 分 ${seconds % 60} 秒`
}

const startedAt = computed(() => parseTime(props.startedAt))
const finishedAt = computed(() => parseTime(props.completedAt))
const elapsed = computed(() => formatDuration((finishedAt.value ?? currentTime.value) - (startedAt.value ?? currentTime.value)))
const progressUpdates = computed(() => (props.progressUpdates || []).filter((update) => update.text.trim()))
const errors = computed(() => props.trace.filter((item) =>
  ['run.cancelled', 'run.failed', 'model.error', 'research_frame.error'].includes(item.kind || ''),
))
const toolActivity = computed(() => (props.tools || [])
  .filter((tool) => tool.presentation !== 'preparation')
  .map((tool, index) => {
    const name = typeof tool.name === 'string' ? tool.name : 'tool'
    const started = parseTime(typeof tool.started_at === 'string' ? tool.started_at : undefined)
    const completed = parseTime(typeof tool.completed_at === 'string' ? tool.completed_at : undefined)
    const status = typeof tool.status === 'string' ? tool.status : 'completed'
    const endedAt = completed ?? (status === 'running' ? currentTime.value : undefined)
    return {
      id: typeof tool.id === 'string' ? tool.id : `${name}-${index}`,
      label: toolLabels[name] || name.replaceAll('_', ' '),
      status,
      duration: formatDuration(started === undefined || endedAt === undefined ? undefined : endedAt - started),
    }
  }))
const activeTool = computed(() => toolActivity.value.find((tool) => tool.status === 'running'))
const latestUpdate = computed(() => progressUpdates.value.at(-1)?.text)
const completed = computed(() => !props.pending && !errors.value.length)
const title = computed(() => errors.value.length ? '本轮研究未完成' : completed.value ? '本轮研究已完成' : '研究进行中')
const fallbackCopy = computed(() => {
  if (errors.value.length) return errors.value.at(-1)?.detail || errors.value.at(-1)?.label || '研究服务未能完成本轮任务。'
  if (activeTool.value) return `正在${activeTool.value.label}。`
  return props.pending ? '正在梳理临床问题并准备下一步研究。' : '已形成可回看的研究记录。'
})
const hasActivity = computed(() => Boolean(props.pending || errors.value.length || progressUpdates.value.length || toolActivity.value.length))
const offsetFromStart = (timestamp: string) => formatDuration((parseTime(timestamp) ?? currentTime.value) - (startedAt.value ?? currentTime.value))
</script>

<template>
  <section v-if="hasActivity" class="research-progress" :class="{ error: errors.length, complete: completed }" aria-label="研究进展">
    <div class="research-progress-head">
      <span>{{ title }}</span>
      <small>{{ elapsed }}</small>
    </div>

    <p class="research-progress-current">{{ latestUpdate || fallbackCopy }}</p>

    <ol v-if="progressUpdates.length" class="research-progress-notes" aria-label="模型研究进展">
      <li v-for="update in progressUpdates" :key="`${update.timestamp}-${update.text}`">
        <i aria-hidden="true" />
        <span>{{ update.text }}</span>
        <small>{{ offsetFromStart(update.timestamp) }}</small>
      </li>
    </ol>

    <details v-if="toolActivity.length" class="research-progress-tools">
      <summary>
        <span>{{ activeTool ? `正在${activeTool.label}` : `研究操作 · ${toolActivity.length} 项` }}</span>
        <small>{{ activeTool?.duration || '查看详情' }}</small>
      </summary>
      <ol>
        <li v-for="tool in toolActivity" :key="tool.id" :class="tool.status">
          <i aria-hidden="true" />
          <span>{{ tool.label }}</span>
          <small>{{ tool.duration }}</small>
        </li>
      </ol>
    </details>
  </section>
</template>
