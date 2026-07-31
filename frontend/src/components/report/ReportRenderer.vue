<script setup lang="ts">
import { computed } from 'vue'
import type { AudienceMode, ResearchMode } from '../../types/domain'
import { extractReferences, parseReport, type Reference } from '../../utils/report'
import ReportNodeView from './ReportNode.vue'

const emit = defineEmits<{ citation: [reference: Reference] }>()
const props = defineProps<{
  markdown: string
  audience: AudienceMode
  researchMode?: ResearchMode
}>()
const nodes = computed(() => parseReport(props.markdown))
const references = computed(() => extractReferences(props.markdown))
const referenceEntries = computed(() => Object.values(references.value).sort((a, b) => Number(a.number) - Number(b.number)))
const referenceMeta = (reference: Reference) => reference.pmid ? `PMID: ${reference.pmid}` : reference.url || '来自报告原文'
</script>

<template>
  <div class="evidence-report">
    <div class="report-markdown">
      <ReportNodeView v-for="(node, index) in nodes" :key="index" :node="node" :references="references" @citation="emit('citation', $event)" />
    </div>
    <details v-if="referenceEntries.length" class="reference-panel">
      <summary>
        <strong>参考文献</strong>
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
