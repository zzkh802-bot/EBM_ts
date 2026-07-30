<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { archiveService } from '../services'
import { useKnowledgeStore, useUiStore } from '../stores'
import type { ArchiveRun, KnowledgeItem } from '../types/domain'
import { newId, nowIso } from '../utils/core'

const knowledge = useKnowledgeStore()
const ui = useUiStore()
const router = useRouter()
const scope = ref<'personal' | 'public'>('personal')
const search = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (value?: string) => {
  if (!value) return '当前会话'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

const backendName = (value?: string) => {
  if (!value) return '循证引擎'
  if (/ebm|agent/i.test(value)) return '循医'
  return value
}

const diseaseTag = (question: string) => {
  if (/SLE|狼疮/i.test(question)) return 'SLE/LN'
  if (/EGFR|肺癌/i.test(question)) return 'EGFR'
  if (/类风湿|RA\b/i.test(question)) return 'RA'
  if (/CKD|肾病|SGLT/i.test(question)) return 'CKD'
  if (/骨髓瘤|M蛋白/i.test(question)) return 'MM'
  return '临床问题'
}

type KnowledgeRow =
  | { kind: 'local'; item: KnowledgeItem }
  | { kind: 'archive'; item: { id: string; name: string; run: ArchiveRun } }

const archiveRows = computed(() =>
  (scope.value === 'personal' ? knowledge.archives : []).map((run) => ({
    kind: 'archive' as const,
    item: {
      id: `archive-${run.archive_id}`,
      name: `Archive #${run.archive_id} · 证据档案袋`,
      run,
    },
  })))

const localRows = computed(() =>
  knowledge.items
    .filter((item) => item.scope === scope.value)
    .map((item) => ({ kind: 'local' as const, item })))

const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const all: KnowledgeRow[] = [...archiveRows.value, ...localRows.value]
  if (!query) return all
  return all.filter((row) => {
    if (row.kind === 'local') {
      return [row.item.name, row.item.status, row.item.type].join(' ').toLowerCase().includes(query)
    }
    const run = row.item.run
    return [row.item.name, run.question, run.answer_preview, run.backend, run.archive_id]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
})

const scopedCount = computed(() => archiveRows.value.length + localRows.value.length)
const pendingCount = computed(() => localRows.value.filter((row) => row.item.status === '待抽取').length)
const reviewCount = computed(() => localRows.value.filter((row) => row.item.status === '待审核').length)
const syncStatus = computed(() => (knowledge.archiveLoading ? '同步中' : '当前会话'))

const importFiles = (files: FileList | null) => {
  const now = nowIso()
  knowledge.items.unshift(...Array.from(files || []).map((file) => ({
    id: newId('kb'),
    name: file.name,
    size: file.size,
    type: file.type || file.name.split('.').pop()?.toUpperCase() || 'FILE',
    scope: scope.value,
    status: '待抽取',
    updatedAt: now,
  })))
  if (fileInput.value) fileInput.value.value = ''
}

const removeLocal = (id: string) => {
  knowledge.items = knowledge.items.filter((item) => item.id !== id)
}

const openArchive = async (run: ArchiveRun) => {
  const id = run.archive_id || run.run_id || run.id
  ui.openDetail(run.title || run.question || `证据档案袋 #${id}`, { run }, 'archive')
  if (id === undefined) return
  try { ui.detailPayload = await archiveService.detail(id) }
  catch (error) { ui.detailPayload = String(error) }
}

onMounted(() => { void knowledge.loadArchives() })
</script>

<template>
  <section id="knowledgePage" class="module-page" aria-label="我的知识库">
    <div class="module-hero">
      <div>
        <h2>我的知识库</h2>
        <p>沉淀本地报告、指南、课题文献和复核记录，后续可接入 RAG 与人工审核流程。</p>
      </div>
      <div class="module-actions">
        <div class="segmented" role="tablist" aria-label="知识库范围">
          <button class="seg-button" :class="{ active: scope === 'personal' }" type="button" @click="scope = 'personal'">个人知识库</button>
          <button class="seg-button" :class="{ active: scope === 'public' }" type="button" @click="scope = 'public'">公共知识库</button>
        </div>
        <button class="pill-button primary" type="button" @click="fileInput?.click()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
          导入知识
        </button>
      </div>
    </div>

    <div class="module-toolbar">
      <button class="pill-button" type="button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        所有内容
      </button>
      <div class="search-box" role="search" aria-label="搜索知识库">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        <input v-model="search" placeholder="搜索知识、指南、疾病、PICO、文献关键词……" aria-label="搜索知识、指南、疾病、PICO、文献关键词">
        <span class="workspace-search-hint">Workspace Search</span>
      </div>
    </div>

    <div class="knowledge-layout">
      <div id="knowledgeMain">
        <div v-if="scope === 'public' && !scopedCount" class="knowledge-empty">
          <div>
            <div class="empty-cube" aria-hidden="true" />
            <h3>公共知识库</h3>
            <p>公共指南、共识、核心教材和科室共建材料会在这里沉淀。</p>
            <button class="pill-button primary" type="button" @click="router.push('/evidence')">进入循证提问</button>
          </div>
        </div>

        <div v-else-if="!rows.length" class="knowledge-empty">
          <div>
            <div class="empty-cube" aria-hidden="true" />
            <h3>{{ scope === 'personal' ? '个人知识库' : '公共知识库' }}</h3>
            <p>
              {{ knowledge.archiveLoading
                ? '正在同步本地证据档案袋。'
                : '上传报告、指南、Word、PPT 或文献片段后，会形成可复核的知识条目；Agent 和文献检索归档也会出现在这里。' }}
            </p>
            <button class="pill-button primary" type="button" @click="fileInput?.click()">+ 创建知识库</button>
          </div>
        </div>

        <div v-else class="knowledge-list">
          <template v-for="row in rows" :key="row.kind === 'local' ? row.item.id : row.item.id">
            <article v-if="row.kind === 'archive'" class="knowledge-card archive-card">
              <div class="doc-icon archive-icon">档案</div>
              <div class="knowledge-card-content">
                <strong>{{ row.item.name }}</strong>
                <span class="knowledge-meta">{{ row.item.run.item_count || 0 }} 条检索/引用线索 · {{ backendName(row.item.run.backend) }} · {{ formatTime(row.item.run.created_at) }}</span>
                <p class="knowledge-preview">{{ row.item.run.question || row.item.run.answer_preview || '暂无回答摘要' }}</p>
                <div class="knowledge-tag-row">
                  <span class="knowledge-tag disease-tag">{{ diseaseTag(String(row.item.run.question || '')) }}</span>
                  <span class="knowledge-tag type-tag">证据档案</span>
                  <span class="knowledge-tag status-tag">已归档</span>
                </div>
              </div>
              <div class="knowledge-card-actions">
                <button class="pill-button" type="button" @click="openArchive(row.item.run)">展开档案袋</button>
              </div>
            </article>

            <article v-else class="knowledge-card">
              <div class="doc-icon">{{ String(row.item.type || 'DOC').slice(0, 4).toUpperCase() }}</div>
              <div class="knowledge-card-content">
                <strong>{{ row.item.name }}</strong>
                <span class="knowledge-meta">{{ formatBytes(row.item.size) }} · {{ formatTime(row.item.updatedAt) }}</span>
                <div class="knowledge-tag-row">
                  <span class="knowledge-tag type-tag">{{ String(row.item.type || '文档').slice(0, 10) }}</span>
                  <span class="knowledge-tag status-tag pending">{{ row.item.status }}</span>
                </div>
              </div>
              <button class="pill-button" type="button" @click="removeLocal(row.item.id)">删除</button>
            </article>
          </template>
          <div v-if="knowledge.archiveLoading" class="knowledge-archive-sync">正在同步证据档案袋...</div>
        </div>
      </div>

      <aside class="knowledge-side" aria-label="知识库状态">
        <h3>知识资产</h3>
        <div class="knowledge-stat-grid">
          <div class="knowledge-stat"><span>知识/档案</span><strong>{{ scopedCount }}</strong></div>
          <div class="knowledge-stat"><span>待抽取</span><strong>{{ pendingCount }}</strong></div>
          <div class="knowledge-stat"><span>Embedding</span><strong class="stat-pending">待接入</strong></div>
          <div class="knowledge-stat"><span>待审核</span><strong>{{ reviewCount }}</strong></div>
        </div>
        <div class="knowledge-side-details">
          <div><span>最后同步</span><strong>{{ syncStatus }}</strong></div>
          <div><span>索引范围</span><strong>本地文件 + Archive</strong></div>
          <div><span>引用复核</span><strong>支持人工复核</strong></div>
        </div>
        <p>上传文件和循证问答归档会统一进入知识资产，可用于后续检索与人工复核。</p>
        <button class="pill-button" type="button" @click="router.push('/evidence')">进入循证提问</button>
      </aside>
    </div>

    <input
      ref="fileInput"
      class="hidden-control"
      type="file"
      multiple
      accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx"
      aria-label="导入知识库文件"
      @change="importFiles(($event.target as HTMLInputElement).files)"
    >
  </section>
</template>
