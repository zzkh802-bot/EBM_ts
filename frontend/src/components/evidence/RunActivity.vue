<script setup lang="ts">
import { computed } from 'vue'
import type { TraceItem } from '../../types/domain'

const props = defineProps<{
  trace: TraceItem[]
  tools?: Array<Record<string, unknown>>
  pending?: boolean
}>()

type ToolStep = { id: string; name: string; status: string; arguments?: unknown; result?: unknown; presentation?: string }

const tools = computed<ToolStep[]>(() => (props.tools || []).map((item, index) => ({
  id: String(item.id || `${item.name || 'tool'}-${index}`),
  name: typeof item.name === 'string' ? item.name : '工具调用',
  status: typeof item.status === 'string' ? item.status : 'completed',
  arguments: item.arguments,
  result: item.result,
  presentation: typeof item.presentation === 'string' ? item.presentation : undefined,
})))
const milestones = computed(() => props.trace.filter((item) => !item.kind?.startsWith('tool.') && item.kind !== 'runtime.session'))
const statusText = (status: string) => ({ running: '执行中', completed: '已完成', error: '失败' })[status] || status
const detail = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const toolLabel = (step: ToolStep) => {
  if (step.presentation === 'preparation') return '准备研究规则'
  return ({
  web_search: '检索网页资料', web_read: '阅读网页全文',
  pubmed_search: '检索 PubMed 文献', pubmed_read: '阅读文献全文',
  guideline_mcp_search: '检索临床指南', guideline_mcp_read: '阅读指南原文',
  evidence_add: '记录关键证据', evidence_list: '核对已记录证据', evidence_read: '核验证据片段',
  report_write: '生成正式报告', report_finalize: '核验并定稿报告',
  read: '阅读研究材料', write: '整理研究材料', edit: '修订研究材料',
}[step.name] || '执行研究步骤')
}
</script>

<template>
  <section v-if="tools.length || milestones.length" class="run-activity" :class="{ pending }" aria-label="研究过程">
    <div class="run-activity-heading">
      <span>{{ pending ? '研究过程' : '本轮研究记录' }}</span>
      <small>{{ pending ? '点击任一步查看证据与结果' : `${tools.length} 个研究步骤` }}</small>
    </div>
    <details v-for="step in tools" :key="step.id" class="run-step" :open="step.status === 'running'">
      <summary>
        <span class="run-step-status" :class="step.status" />
        <strong>{{ toolLabel(step) }}</strong>
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
