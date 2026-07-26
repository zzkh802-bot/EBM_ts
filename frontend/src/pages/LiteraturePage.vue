<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLiteratureStore } from '../stores'
import type { LiteratureItem } from '../types/domain'

const literature = useLiteratureStore()
const query = ref('')
const defaults = ['EGFR', 'RA', 'SLE', 'CKD', '肝癌 PD-1']

const runSearch = (value = query.value) => {
  void literature.search(value.trim() || 'clinical medicine large language models systematic review')
}

const searchRecent = (value: string) => {
  query.value = value
  void literature.search(value)
}

const title = (item: LiteratureItem) => item.title || item.article_title || 'Untitled'
const summary = (item: LiteratureItem) => item.zh || item.summary || item.abstract || ''
const journal = (item: LiteratureItem) => item.journal || item.source || item.venue || 'PubMed'
const date = (item: LiteratureItem) => item.publication_date || item.date || item.year || ''
const source = (item: LiteratureItem) => item.source_database || item.retrieval_api || 'PubMed / NCBI E-utilities'
const tags = (item: LiteratureItem) => item.tags || item.publication_types || item.mesh_terms || []
const url = (item: LiteratureItem) =>
  item.url || (item.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/` : item.doi ? `https://doi.org/${item.doi}` : '')

const reliability = (item: LiteratureItem) => {
  const score = Number(item.reliability?.score)
  const level = item.reliability?.level || (score >= 78 ? 'high' : score >= 58 ? 'moderate' : 'screening')
  return {
    score: Number.isFinite(score) ? score : null,
    level,
    label: item.reliability?.label || (level === 'high' ? '高可信候选' : level === 'moderate' ? '中等可信候选' : '初筛线索'),
    reasons: item.reliability?.reasons || [],
  }
}

const recentTags = computed(() => (literature.recent.length ? literature.recent : defaults).slice(0, 6))
const rows = computed(() => literature.items.slice(0, 8))
const statusLabel = computed(() =>
  literature.loading ? '检索中' : literature.error ? '检索异常' : rows.value.length ? '已完成' : '等待检索')

let refreshTimer: number | undefined
onMounted(() => {
  refreshTimer = window.setInterval(() => {
    if (literature.lastQuery) void literature.search(literature.lastQuery, true)
  }, 30 * 60 * 1000)
})
onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  literature.cancel()
})
</script>

<template>
  <section id="literaturePage" class="module-page" aria-label="文献速递">
    <div class="literature-hero">
      <h2>AI 文献检索</h2>
      <p>基于 PubMed、PMC、指南数据库的循证医学文献检索与证据分析。</p>
    </div>

    <div class="literature-search-shell">
      <div class="search-box literature-search" role="search" aria-label="检索医学文献">
        <svg width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        <input
          v-model="query"
          placeholder="请输入疾病、PICO、药物、PMID、关键词……"
          aria-label="输入医学文献检索主题"
          @keydown.enter="runSearch()"
        >
        <button class="pill-button primary" type="button" :disabled="literature.loading" @click="runSearch()">
          {{ literature.loading ? '检索中…' : '搜索' }}
        </button>
      </div>
      <div class="literature-source-tags" aria-label="支持的数据源">
        <span>PubMed</span>
        <span>PMC</span>
        <span>Guidelines</span>
        <span>ClinicalTrials</span>
      </div>
    </div>

    <div class="literature-recent" aria-label="最近搜索">
      <span class="literature-recent-label">最近搜索</span>
      <div>
        <span
          v-for="item in recentTags"
          :key="item"
          role="button"
          tabindex="0"
          @click="searchRecent(item)"
          @keydown.enter.prevent="searchRecent(item)"
        >{{ item }}</span>
      </div>
    </div>

    <section class="literature-panel">
      <h3>文献速递</h3>
      <p class="literature-panel-note">当前实时调用 PubMed / MEDLINE 的 NCBI E-utilities 做元数据级初筛；可靠性标签用于排序和复核提示，不等同于全文 GRADE 结论。</p>
      <div class="literature-list">
        <article v-if="literature.loading" class="literature-item">
          <div class="literature-rank">AI</div>
          <div>
            <strong>正在检索文献证据源</strong>
            <div class="heartbeat-row">
              <span class="heartbeat" />
              <span>PubMed / PMC / evidence panel</span>
              <span class="thinking-dots"><i /><i /><i /></span>
            </div>
            <span class="literature-status processing"><i />检索中</span>
          </div>
        </article>

        <template v-else-if="rows.length">
          <component
            :is="url(item) ? 'a' : 'article'"
            v-for="(item, index) in rows"
            :key="item.pmid || item.doi || index"
            class="literature-item"
            :class="{ clickable: Boolean(url(item)) }"
            v-bind="url(item) ? { href: url(item), target: '_blank', rel: 'noreferrer noopener', 'aria-label': `打开 PubMed 文献：${title(item)}` } : {}"
          >
            <div class="literature-rank">{{ index + 1 }}</div>
            <div>
              <strong>{{ title(item) }}</strong>
              <div v-if="summary(item)" class="literature-zh">{{ summary(item).slice(0, 120) }}</div>
              <span class="literature-meta">
                {{ journal(item) }}
                <template v-if="date(item)"> · {{ date(item) }}</template>
                <template v-if="item.pmid"> · PMID {{ item.pmid }}</template>
              </span>
              <div class="literature-quality">
                <span class="quality-badge" :class="reliability(item).level">
                  {{ reliability(item).label }}{{ reliability(item).score !== null ? ` ${reliability(item).score}` : '' }}
                </span>
                <span class="literature-source">{{ source(item) }}</span>
                <span
                  class="literature-status"
                  :class="tags(item).some((tag) => String(tag).includes('失败')) ? 'waiting' : 'completed'"
                >
                  <i />{{ tags(item).some((tag) => String(tag).includes('失败')) ? '等待重试' : '已完成' }}
                </span>
                <span v-if="url(item)" class="lit-open">打开原始记录</span>
              </div>
              <div v-if="reliability(item).reasons.length" class="literature-zh">
                {{ reliability(item).reasons.slice(0, 2).join('；') }}
              </div>
              <div v-if="tags(item).length" class="lit-tags">
                <span v-for="tag in tags(item).slice(0, 4)" :key="String(tag)" class="lit-tag">{{ tag }}</span>
              </div>
            </div>
          </component>
        </template>

        <div v-else class="literature-empty-state">
          <div class="literature-empty-head">
            <div class="literature-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="m20 20-3.6-3.6M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </div>
            <div>
              <strong>输入主题后开始实时检索</strong>
              <p>系统将按循证工作流检索、筛选并分析可追溯文献。</p>
            </div>
          </div>
          <div class="literature-workflow" aria-label="文献检索工作流">
            <div><span>1</span><p><strong>输入问题</strong><small>疾病、PICO、药物或 PMID</small></p></div>
            <div><span>2</span><p><strong>PubMed 检索</strong><small>连接医学文献证据源</small></p></div>
            <div><span>3</span><p><strong>AI 自动筛选</strong><small>识别相关研究与证据类型</small></p></div>
            <div><span>4</span><p><strong>引用分析</strong><small>检查来源与结论支持关系</small></p></div>
            <div><span>5</span><p><strong>输出循证摘要</strong><small>生成可复核的检索结果</small></p></div>
          </div>
          <div class="literature-empty-status">
            <i />
            <span>当前状态</span>
            <strong>{{ statusLabel }}</strong>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>
