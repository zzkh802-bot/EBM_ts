<script setup lang="ts">
import type { InlineNode, Reference } from '../../utils/report'

defineProps<{ nodes: InlineNode[]; references: Record<string, Reference> }>()
const emit = defineEmits<{ citation: [reference: Reference] }>()
</script>

<template>
  <template v-for="(node, index) in nodes" :key="index">
    <br v-if="node.type === 'break'">
    <strong v-else-if="node.type === 'strong'">{{ node.value }}</strong>
    <code v-else-if="node.type === 'code'">{{ node.value }}</code>
    <a v-else-if="node.type === 'link'" :href="node.href" target="_blank" rel="noreferrer noopener">{{ node.label }}</a>
    <button
      v-else-if="node.type === 'citation' && references[node.number]"
      class="citation-pill"
      type="button"
      @click="emit('citation', references[node.number])"
    >{{ node.number }}</button>
    <span v-else-if="node.type === 'citation'">[{{ node.number }}]</span>
    <template v-else>{{ node.value }}</template>
  </template>
</template>
