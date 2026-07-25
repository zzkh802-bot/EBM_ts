<script setup lang="ts">
import { computed } from 'vue'
import type { AudienceMode, ResearchMode } from '../../types/domain'
import { extractReferences, parseReport, projectReport, reportPlainText, type InlineNode, type Reference, type ReportNode } from '../../utils/report'
import InlineContent from './InlineContent.vue'
import ReportNodeView from './ReportNode.vue'

const props = withDefaults(defineProps<{
  markdown: string
  audience: AudienceMode
  researchMode?: ResearchMode
}>(), { researchMode: 'instant' })
const emit = defineEmits<{ citation: [reference: Reference] }>()
const nodes = computed(() => projectReport(parseReport(props.markdown), props.audience))
const references = computed(() => extractReferences(props.markdown))
const citationsIn = (inline: InlineNode[]) => inline.filter((node) => node.type === 'citation').map((node) => node.number)
const visibleCitationNumbers = computed(() => new Set(nodes.value.flatMap((node) => {
  if (node.type === 'heading' || node.type === 'paragraph') return citationsIn(node.children)
  if (node.type === 'list') return node.items.flatMap(citationsIn)
  if (node.type === 'table') return [...node.headers, ...node.rows.flat()].flatMap(citationsIn)
  return []
})))
const displayedReferences = computed(() => Object.fromEntries(Object.entries(references.value).filter(([number]) =>
  props.audience === 'clinician' || visibleCitationNumbers.value.has(number))))
type SectionKind = 'authority' | 'status' | 'reliability' | 'safety' | 'action' | ''
const sectionKind = (title: string): SectionKind => {
  const clean = title.replace(/\s+/g, '')
  if (/权威建议|临床底线|核心结论|结论摘要|综合判断|结论与建议/.test(clean)) return 'authority'
  if (/证据状态|完成思考|引用核验|检索状态|获益.?风险量化/.test(clean)) return 'status'
  if (/可靠性|证据信度|可信度/.test(clean)) return 'reliability'
  if (/安全|风险|禁忌|红旗|不良反应|出血|死亡|感染|并发症|毒性|自杀|自伤/.test(clean)) return 'safety'
  if (/行动|下一步|管理|决策路径|临床决策|个体化决策|临床建议|治疗建议|处理建议/.test(clean)) return 'action'
  return ''
}
const sectionLabel = (kind: SectionKind) => ({
  authority: '建议', status: '证据', reliability: '可信', safety: '安全', action: '行动', '': 'DP',
}[kind])
const sectionPreview = (nodes: ReportNode[]) => {
  const text = reportPlainText(nodes).replace(/[#*_`>|-]/g, '').replace(/\[[0-9]{1,3}\]/g, '').replace(/\s+/g, ' ').trim()
  if (!text) return '点击展开查看完整内容'
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}
const sections = computed(() => {
  type Section = {
    heading?: Extract<ReportNode, { type: 'heading' }>
    nodes: ReportNode[]
    open: boolean
    kind: SectionKind
    group?: boolean
  }
  const result: Section[] = [{ nodes: [], open: true, kind: '' }]
  const hasLevelThreeChild = (headingIndex: number) => {
    for (let index = headingIndex + 1; index < nodes.value.length; index += 1) {
      const candidate = nodes.value[index]
      if (candidate.type !== 'heading') continue
      if (candidate.level <= 2) return false
      if (candidate.level === 3) return true
    }
    return false
  }
  nodes.value.forEach((node, index) => {
    if (node.type === 'heading' && (node.level === 2 || node.level === 3)) {
      const group = node.level === 2 && hasLevelThreeChild(index)
      result.push({
        heading: node,
        nodes: [],
        open: false,
        kind: sectionKind(node.title),
        group,
      })
    } else result[result.length - 1].nodes.push(node)
  })
  return result.filter((section) => section.heading || section.nodes.length)
})
const referenceEntries = computed(() => Object.values(displayedReferences.value).sort((a, b) => Number(a.number) - Number(b.number)))
const referenceMeta = (reference: Reference) => reference.pmid
  ? `PMID: ${reference.pmid}`
  : reference.url || '来自本轮回答解析'
</script>

<template>
  <div class="evidence-report" :class="[`report-audience-${audience}`, `report-mode-${researchMode}`]">
    <div class="report-markdown">
      <template v-for="(section, index) in sections" :key="index">
        <section v-if="section.heading && section.group" class="report-section-group">
          <ReportNodeView :node="section.heading" :references="displayedReferences" @citation="emit('citation', $event)" />
          <ReportNodeView v-for="(node, nodeIndex) in section.nodes" :key="nodeIndex" :node="node" :references="displayedReferences" @citation="emit('citation', $event)" />
        </section>
        <section v-else-if="section.heading && section.kind" class="report-section-card" :class="section.kind">
          <div class="section-card-title">
            <span class="section-symbol">{{ sectionLabel(section.kind) }}</span>
            <strong><InlineContent :nodes="section.heading.children" :references="displayedReferences" @citation="emit('citation', $event)" /></strong>
          </div>
          <div class="section-card-body">
            <ReportNodeView v-for="(node, nodeIndex) in section.nodes" :key="nodeIndex" :node="node" :references="displayedReferences" @citation="emit('citation', $event)" />
          </div>
        </section>
        <details v-else-if="section.heading" class="report-fold" :open="section.open">
          <summary>
            <span class="report-fold-title">
              <strong><InlineContent :nodes="section.heading.children" :references="displayedReferences" @citation="emit('citation', $event)" /></strong>
              <span>{{ sectionPreview(section.nodes) }}</span>
            </span>
            <span class="report-fold-toggle" aria-hidden="true" />
          </summary>
          <div class="report-fold-body">
            <ReportNodeView v-for="(node, nodeIndex) in section.nodes" :key="nodeIndex" :node="node" :references="displayedReferences" @citation="emit('citation', $event)" />
          </div>
        </details>
        <template v-else>
          <ReportNodeView v-for="(node, nodeIndex) in section.nodes" :key="nodeIndex" :node="node" :references="displayedReferences" @citation="emit('citation', $event)" />
        </template>
      </template>
    </div>
    <details v-if="referenceEntries.length" class="reference-panel">
      <summary>
        <strong>{{ audience === 'public' ? '信息来源' : '参考文献' }}</strong>
        <span>{{ referenceEntries.length }} 条，可点击编号查看详情</span>
      </summary>
      <div class="reference-panel-body">
        <article v-for="reference in referenceEntries" :key="reference.number" class="reference-card">
          <button class="reference-card-index" type="button" @click="emit('citation', reference)">{{ reference.number }}</button>
          <div>
            <strong>{{ reference.title }}</strong>
            <p>{{ referenceMeta(reference) }}<template v-if="reference.url"> · <a :href="reference.url" target="_blank" rel="noreferrer noopener">查看原文</a></template></p>
          </div>
        </article>
      </div>
    </details>
  </div>
</template>
