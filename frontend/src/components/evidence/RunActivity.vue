<script setup lang="ts">
import { computed } from 'vue'
import type { TraceItem } from '../../types/domain'

const props = defineProps<{
  trace: TraceItem[]
  tools?: Array<Record<string, unknown>>
  pending?: boolean
}>()

type ToolStep = { id: string; name: string; status: string; arguments?: unknown; result?: unknown }

const tools = computed<ToolStep[]>(() => (props.tools || []).map((item, index) => ({
  id: String(item.id || `${item.name || 'tool'}-${index}`),
  name: typeof item.name === 'string' ? item.name : '工具调用',
  status: typeof item.status === 'string' ? item.status : 'completed',
  arguments: item.arguments,
  result: item.result,
})))
const milestones = computed(() => props.trace.filter((item) => !item.kind?.startsWith('tool.')))
const statusText = (status: string) => ({ running: '执行中', completed: '已完成', error: '失败' })[status] || status
const detail = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
</script>

<template>
  <section v-if="tools.length || milestones.length" class="run-activity" :class="{ pending }" aria-label="Agent 运行过程">
    <div class="run-activity-heading"><span>{{ pending ? '正在执行' : '本轮运行记录' }}</span><small>{{ tools.length }} 个工具调用</small></div>
    <details v-for="step in tools" :key="step.id" class="run-step" :open="step.status === 'running'">
      <summary>
        <span class="run-step-status" :class="step.status" />
        <strong>{{ step.name }}</strong>
        <small>{{ statusText(step.status) }}</small>
      </summary>
      <div class="run-step-detail">
        <template v-if="step.arguments !== undefined"><span>输入</span><pre>{{ detail(step.arguments) }}</pre></template>
        <template v-if="step.result !== undefined"><span>结果</span><pre>{{ detail(step.result) }}</pre></template>
      </div>
    </details>
    <details v-for="(item, index) in milestones" :key="`${item.kind}-${index}`" class="run-step trace">
      <summary><span class="run-step-status" /><strong>{{ item.label || '运行状态' }}</strong><small>{{ item.timestamp?.slice(11, 19) }}</small></summary>
      <p v-if="item.detail">{{ item.detail }}</p>
    </details>
  </section>
</template>
