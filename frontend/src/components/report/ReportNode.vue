<script setup lang="ts">
import type { Reference, ReportNode } from '../../utils/report'
import InlineContent from './InlineContent.vue'
defineProps<{ node: ReportNode; references: Record<string, Reference> }>()
const emit = defineEmits<{ citation: [reference: Reference] }>()
</script>

<template>
  <component :is="`h${node.level}`" v-if="node.type === 'heading'">
    <InlineContent :nodes="node.children" :references="references" @citation="emit('citation', $event)" />
  </component>
  <p v-else-if="node.type === 'paragraph'"><InlineContent :nodes="node.children" :references="references" @citation="emit('citation', $event)" /></p>
  <component :is="node.ordered ? 'ol' : 'ul'" v-else-if="node.type === 'list'">
    <li v-for="(item, index) in node.items" :key="index"><InlineContent :nodes="item" :references="references" @citation="emit('citation', $event)" /></li>
  </component>
  <div v-else-if="node.type === 'table'" class="report-table-wrap" :class="{ 'is-wide': node.headers.length >= 3 }">
    <table><thead><tr><th v-for="(cell, index) in node.headers" :key="index"><InlineContent :nodes="cell" :references="references" @citation="emit('citation', $event)" /></th></tr></thead>
      <tbody><tr v-for="(row, rowIndex) in node.rows" :key="rowIndex"><td v-for="(cell, index) in row" :key="index"><InlineContent :nodes="cell" :references="references" @citation="emit('citation', $event)" /></td></tr></tbody></table>
  </div>
  <hr v-else>
</template>
