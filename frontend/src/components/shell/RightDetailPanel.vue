<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { workspaceService } from '../../services'
import { useUiStore } from '../../stores'
import type { CitationDetailResponse } from '../../types/domain'
import type { Reference } from '../../utils/report'
import { safeExternalUrl } from '../../utils/browser'

const ui = useUiStore()
type CitationRequest = Reference & { sessionId?: string; reportPath?: string }
const citation = computed(() => ui.detailPayload as CitationRequest | null)
const detail = ref<CitationDetailResponse | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailSequence = 0

const provenanceLabel = (value: string) => ({
  primary_full_text: '研究全文', primary_abstract: '研究摘要', guideline_official: '官方指南',
  guideline_mirror_verified: '已核验指南镜像', independent_guideline: '独立指南',
  expert_consensus: '专家共识', secondary_direct_quote: '二手直接引文',
  secondary_paraphrase: '二手转述', other: '其他来源',
}[value] || value)
const relationLabel = (value: string) => ({
  supports: '支持该主张', partially_supports: '部分支持', refutes: '与主张相反',
}[value] || value)

watch(() => [ui.detailOpen, citation.value?.sessionId, citation.value?.reportPath, citation.value?.number] as const, async ([open, sessionId, reportPath, number]) => {
  const request = ++detailSequence
  detail.value = null
  detailError.value = ''
  detailLoading.value = false
  if (!open || !sessionId || !reportPath || !number) return
  detailLoading.value = true
  try {
    const response = await workspaceService.citation(sessionId, reportPath, number)
    if (request === detailSequence) detail.value = response
  } catch (error) {
    if (request === detailSequence) detailError.value = error instanceof Error ? error.message : '无法读取这条引用的证据片段。'
  } finally {
    if (request === detailSequence) detailLoading.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="citation-backdrop" :hidden="!ui.detailOpen" data-citation-close @click="ui.detailOpen = false" />
  <aside class="citation-sheet" :aria-hidden="!ui.detailOpen" aria-label="引用核验">
    <div class="citation-head">
      <div><span>引用核验</span><strong>{{ ui.detailTitle || '参考文献' }}</strong></div>
      <button class="citation-close" type="button" aria-label="关闭参考文献详情" @click="ui.detailOpen = false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <div class="citation-source-meta">
      <div class="citation-meta-row">
        <span v-if="citation?.pmid">PMID {{ citation.pmid }}</span>
        <span v-if="detail?.evidence.length">{{ detail.evidence.length }} 条已登记原文</span>
      </div>
    </div>
    <div class="citation-body">
      <div class="citation-source-card">
        <span>标准参考文献</span>
        <p>{{ citation?.content }}</p>
      </div>
      <p v-if="detailLoading" class="citation-detail-state">正在核验对应的证据片段…</p>
      <p v-else-if="detailError" class="citation-detail-state error">{{ detailError }}</p>
      <p v-else-if="citation?.sessionId && !detail?.evidence.length" class="citation-detail-state">这条引用暂未找到可展示的原文片段。</p>
      <section v-if="detail?.evidence.length" class="citation-evidence-list" aria-label="已核验证据原文">
        <article v-for="(item, index) in detail.evidence" :key="`${detail.number}-${index}`" class="citation-evidence-card">
          <div class="citation-evidence-head">
            <span :class="{ verified: item.verified }">{{ item.verified ? '原文已核验' : '原文待复核' }}</span>
            <small>{{ provenanceLabel(item.provenance) }} · {{ relationLabel(item.relation) }}</small>
          </div>
          <p class="citation-evidence-claim">{{ item.claim }}</p>
          <blockquote class="citation-evidence-quote">{{ item.quote }}</blockquote>
          <div class="citation-evidence-source">
            <span><small>原文来源</small><strong>{{ item.source.title }}</strong></span>
            <a v-if="safeExternalUrl(item.source.url)" :href="safeExternalUrl(item.source.url)" target="_blank" rel="noreferrer noopener">打开原文 ↗</a>
            <small v-else>当前来源未提供公开链接</small>
          </div>
        </article>
      </section>
    </div>
    <div class="citation-actions">
      <a v-if="safeExternalUrl(citation?.url || '')" class="pill-button" :href="safeExternalUrl(citation?.url || '')" target="_blank" rel="noreferrer noopener">文献页面</a>
      <button type="button" data-citation-close @click="ui.detailOpen = false">关闭</button>
    </div>
  </aside>
</template>
