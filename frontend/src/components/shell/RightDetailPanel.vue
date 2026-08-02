<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores'
import type { Reference } from '../../utils/report'
import { safeExternalUrl } from '../../utils/browser'

const ui = useUiStore()
const citation = computed(() => ui.detailPayload as Reference | null)
</script>

<template>
  <div class="citation-backdrop" :hidden="!ui.detailOpen" data-citation-close @click="ui.detailOpen = false" />
  <aside class="citation-sheet" :aria-hidden="!ui.detailOpen" aria-label="参考文献详情">
    <div class="citation-head">
      <strong>{{ ui.detailTitle || '参考文献' }}</strong>
      <button class="citation-close" type="button" aria-label="关闭参考文献详情" @click="ui.detailOpen = false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <div class="citation-source-meta">
      <div class="citation-meta-row">
        <span v-if="citation?.pmid">PMID {{ citation.pmid }}</span>
        <span v-if="citation?.url">可访问原文</span>
      </div>
    </div>
    <div class="citation-body">
      <div class="citation-source-card">
        <strong>{{ citation?.title }}</strong>
        <p>{{ citation?.content }}</p>
      </div>
    </div>
    <div class="citation-actions">
      <a v-if="safeExternalUrl(citation?.url || '')" class="pill-button primary" :href="safeExternalUrl(citation?.url || '')" target="_blank" rel="noreferrer noopener">打开原文</a>
      <a v-if="citation?.pmid" class="pill-button" :href="`https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`" target="_blank" rel="noreferrer noopener">打开 PMID</a>
      <button type="button" data-citation-close @click="ui.detailOpen = false">关闭</button>
    </div>
  </aside>
</template>
