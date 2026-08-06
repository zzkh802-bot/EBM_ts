<script setup lang="ts">
import { computed } from 'vue'
import { parseReport } from '../../utils/report'
import ReportNodeView from './ReportNode.vue'

const props = defineProps<{ markdown: string }>()
const nodes = computed(() => parseReport(props.markdown, { stripReferences: false }))
</script>

<template>
  <div class="markdown-content">
    <ReportNodeView v-for="(node, index) in nodes" :key="index" :node="node" :references="{}" />
  </div>
</template>
