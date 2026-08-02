<script setup lang="ts">
import { computed } from 'vue'
import type { AudienceMode } from '../../types/domain'
import { extractReferences, parseReport, projectReport, type Reference } from '../../utils/report'
import ReportNodeView from './ReportNode.vue'

const emit = defineEmits<{ citation: [reference: Reference] }>()
const props = defineProps<{
  markdown: string
  audience: AudienceMode
}>()
const nodes = computed(() => projectReport(parseReport(props.markdown), props.audience))
const references = computed(() => extractReferences(props.markdown))
const referenceEntries = computed(() => Object.values(references.value).sort((a, b) => Number(a.number) - Number(b.number)))
</script>

<template>
  <section class="evidence-report" aria-label="循证报告正文">
    <div class="report-markdown">
      <ReportNodeView v-for="(node, index) in nodes" :key="index" :node="node" :references="references" @citation="emit('citation', $event)" />
    </div>
    <section v-if="referenceEntries.length" class="reference-panel" aria-label="参考文献">
      <header>
        <strong>参考文献</strong>
        <span>{{ referenceEntries.length }} 条</span>
      </header>
      <div class="reference-panel-body">
        <button v-for="reference in referenceEntries" :key="reference.number" class="reference-card" type="button" :aria-label="`核验引用 ${reference.number}`" @click="emit('citation', reference)">
          <span class="reference-card-index">[{{ reference.number }}]</span>
          <p>{{ reference.content }}</p>
        </button>
      </div>
    </section>
  </section>
</template>
