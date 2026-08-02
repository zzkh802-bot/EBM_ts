<script setup lang="ts">
import { computed } from 'vue'
import { parseReport } from '../../utils/report'
import ReportNodeView from '../report/ReportNode.vue'

const props = defineProps<{ markdown: string }>()
const nodes = computed(() => parseReport(props.markdown))
</script>

<template>
  <div class="patient-report-markdown">
    <ReportNodeView v-for="(node, index) in nodes" :key="index" :node="node" :references="{}" />
  </div>
</template>
