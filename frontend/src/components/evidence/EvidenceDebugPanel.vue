<script setup lang="ts">
import { ref } from 'vue'
import { evidenceTools } from '../../services'
const output = ref<unknown>(null)
const running = ref(false)
const run = async (tool: keyof typeof evidenceTools) => {
  running.value = true
  try { output.value = await evidenceTools[tool]({ question: '', pmid: '', pmids: [], retmax: 3, skip_pmc: true }) }
  catch (error) { output.value = String(error) }
  finally { running.value = false }
}
</script>

<template>
  <details class="debug-panel hidden-control">
    <summary>Evidence tools</summary>
    <button v-for="tool in (Object.keys(evidenceTools) as Array<keyof typeof evidenceTools>)" :key="tool" :disabled="running" @click="run(tool)">{{ tool }}</button>
    <pre>{{ output }}</pre>
  </details>
</template>
