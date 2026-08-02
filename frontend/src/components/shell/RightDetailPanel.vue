<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { workspaceService } from '../../services'
import { useUiStore } from '../../stores'
import type { CitationDetailResponse, CitationSourceResponse } from '../../types/domain'
import type { Reference } from '../../utils/report'
import { safeExternalUrl } from '../../utils/browser'
import MarkdownContent from '../report/MarkdownContent.vue'

const ui = useUiStore()
type CitationRequest = Reference & { sessionId?: string; reportPath?: string }
const citation = computed(() => ui.detailPayload as CitationRequest | null)
const detail = ref<CitationDetailResponse | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const openSourceIndex = ref<number | null>(null)
const sourceDetails = ref<Record<number, CitationSourceResponse>>({})
const sourceLoadingIndex = ref<number | null>(null)
const sourceError = ref('')
let detailSequence = 0
let sourceSequence = 0

const provenanceLabel = (value: string) => ({
  primary_full_text: '研究全文', primary_abstract: '研究摘要', guideline_official: '官方指南',
  guideline_mirror_verified: '已核验指南镜像', independent_guideline: '独立指南',
  expert_consensus: '专家共识', secondary_direct_quote: '二手直接引文',
  secondary_paraphrase: '二手转述', other: '其他来源',
}[value] || value)
const relationLabel = (value: string) => ({
  supports: '支持该主张', partially_supports: '部分支持', refutes: '与主张相反',
}[value] || value)
const archiveActionLabel = (scope: string, expanded: boolean) => {
  if (expanded) return '收起归档内容'
  if (scope === 'abstract') return '查看归档摘要'
  if (scope === 'retrieved_excerpt') return '查看归档上下文'
  return '查看归档原文'
}
const archiveScopeLabel = (scope: string) => ({
  archived_document: '内部归档原文', retrieved_excerpt: '检索归档上下文', abstract: '归档摘要',
}[scope] || '内部归档材料')

async function toggleSource(index: number) {
  if (openSourceIndex.value === index) {
    openSourceIndex.value = null
    sourceError.value = ''
    return
  }
  openSourceIndex.value = index
  sourceError.value = ''
  if (sourceDetails.value[index]) return
  const sessionId = citation.value?.sessionId
  const reportPath = citation.value?.reportPath
  const number = citation.value?.number
  if (!sessionId || !reportPath || !number) return
  const request = ++sourceSequence
  sourceLoadingIndex.value = index
  try {
    const response = await workspaceService.citationSource(sessionId, reportPath, number, index)
    if (request === sourceSequence) sourceDetails.value = { ...sourceDetails.value, [index]: response }
  } catch (error) {
    if (request === sourceSequence) sourceError.value = error instanceof Error ? error.message : '无法读取归档原文。'
  } finally {
    if (request === sourceSequence) sourceLoadingIndex.value = null
  }
}

watch(() => [ui.detailOpen, citation.value?.sessionId, citation.value?.reportPath, citation.value?.number] as const, async ([open, sessionId, reportPath, number]) => {
  const request = ++detailSequence
  detail.value = null
  detailError.value = ''
  detailLoading.value = false
  openSourceIndex.value = null
  sourceDetails.value = {}
  sourceLoadingIndex.value = null
  sourceError.value = ''
  sourceSequence += 1
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
          <div class="citation-evidence-quote" aria-label="用于本结论的原文片段">
            <MarkdownContent :markdown="item.quote" />
          </div>
          <div class="citation-evidence-source">
            <span>
              <small>原文来源</small>
              <strong>{{ item.source.title }}</strong>
              <small v-if="item.source.institution" class="citation-source-institution">{{ item.source.institution }}</small>
            </span>
            <div class="citation-source-actions">
              <a v-if="safeExternalUrl(item.source.url)" :href="safeExternalUrl(item.source.url)" target="_blank" rel="noreferrer noopener">公开原文 ↗</a>
              <button v-if="item.source.archive_available" class="citation-source-archive-button" type="button" @click="toggleSource(index)">
                {{ archiveActionLabel(item.source.archive_scope, openSourceIndex === index) }}
              </button>
            </div>
          </div>
          <p v-if="openSourceIndex === index && sourceLoadingIndex === index" class="citation-detail-state">正在读取内部归档…</p>
          <p v-else-if="openSourceIndex === index && sourceError" class="citation-detail-state error">{{ sourceError }}</p>
          <section v-else-if="openSourceIndex === index && sourceDetails[index]" class="citation-source-document" aria-label="归档原文">
            <header>
              <span>{{ archiveScopeLabel(sourceDetails[index].scope) }}</span>
              <strong>{{ sourceDetails[index].title }}</strong>
            </header>
            <MarkdownContent :markdown="sourceDetails[index].markdown" />
          </section>
        </article>
      </section>
    </div>
    <div class="citation-actions">
      <a v-if="safeExternalUrl(citation?.url || '')" class="pill-button" :href="safeExternalUrl(citation?.url || '')" target="_blank" rel="noreferrer noopener">文献页面</a>
      <button type="button" data-citation-close @click="ui.detailOpen = false">关闭</button>
    </div>
  </aside>
</template>
