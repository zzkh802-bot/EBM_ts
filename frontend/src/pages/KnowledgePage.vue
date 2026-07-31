<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useKnowledgeStore, useUiStore } from '../stores'
import type { WorkspaceAsset } from '../types/domain'

type ResearchArchive = {
  id: string
  sessionId: string
  title: string
  files: WorkspaceAsset[]
  report?: WorkspaceAsset
  updatedAt: string
  evidenceCount: number
  sourceCount: number
}

const knowledge = useKnowledgeStore()
const ui = useUiStore()
const router = useRouter()
const search = ref('')

const archiveTitle = (report: WorkspaceAsset | undefined, fallback: string) => {
  const title = report?.path.split('/').at(-1)?.replace(/\.md$/, '')
  return title || (/^\d+$/.test(fallback) ? '未命名循证研究' : fallback)
}
const archives = computed<ResearchArchive[]>(() => {
  const bySession = new Map<string, WorkspaceAsset[]>()
  for (const asset of knowledge.workspaceAssets) {
    const files = bySession.get(asset.sessionId) || []
    files.push(asset)
    bySession.set(asset.sessionId, files)
  }
  return [...bySession.entries()].map(([sessionId, files]) => {
    const report = files.find((file) => file.kind === 'report')
    return {
      id: sessionId,
      sessionId,
      title: archiveTitle(report, files[0]?.sessionTitle || ''),
      files,
      report,
      updatedAt: files.reduce((latest, file) => latest > file.modified_at ? latest : file.modified_at, ''),
      evidenceCount: files.filter((file) => file.kind === 'evidence').length,
      sourceCount: files.filter((file) => file.kind === 'source').length,
    }
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return archives.value
  return archives.value.filter((archive) => [archive.title, ...archive.files.map((file) => file.path)].join(' ').toLowerCase().includes(query))
})
const reportCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'report').length)
const sourceCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'source').length)
const evidenceCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'evidence').length)
const openArchive = (archive: ResearchArchive) => {
  ui.openDetail(archive.title, { session_id: archive.sessionId, files: archive.files, preferred_path: archive.report?.path }, 'workspace')
}

onMounted(() => { void knowledge.loadWorkspaceAssets() })
</script>

<template>
  <section class="asset-page" aria-label="研究资产库">
    <header class="asset-page-head">
      <div>
        <span>研究资产库</span>
        <h2>每次循证研究，都会留下可复核的依据。</h2>
        <p>这里直接读取本地循医服务为各会话生成的报告、研究框架、证据记录和来源归档。</p>
      </div>
      <button class="asset-refresh" type="button" :disabled="knowledge.workspaceLoading" @click="knowledge.loadWorkspaceAssets()">
        {{ knowledge.workspaceLoading ? '正在同步…' : '刷新资产' }}
      </button>
    </header>

    <div class="asset-summary" aria-label="资产概览">
      <span><strong>{{ reportCount }}</strong> 正式报告</span>
      <span><strong>{{ evidenceCount }}</strong> 证据记录</span>
      <span><strong>{{ sourceCount }}</strong> 来源归档</span>
    </div>

    <div class="asset-toolbar">
      <label>
        <span class="sr-only">搜索研究资产</span>
        <input v-model="search" type="search" placeholder="搜索研究主题、正式报告或来源">
      </label>
      <span>每项研究均可展开查看完整文件目录</span>
    </div>

    <section v-if="knowledge.workspaceLoading" class="asset-empty">正在读取各会话的研究工作区…</section>
    <section v-else-if="!rows.length" class="asset-empty">
      <strong>还没有研究资产</strong>
      <p>完成一次循证研究后，正式报告、研究框架和证据文件会自动出现在这里。</p>
      <button type="button" @click="router.push('/evidence')">开始循证研究</button>
    </section>
    <section v-else class="asset-list" aria-label="已完成循证研究">
      <button v-for="archive in rows" :key="archive.id" class="asset-project" type="button" @click="openArchive(archive)">
        <span class="asset-project-state">已归档</span>
        <span class="asset-main">
          <strong>{{ archive.title }}</strong>
          <small>{{ archive.report ? '正式报告已生成' : '研究文件已归档' }} · {{ archive.evidenceCount }} 条证据记录 · {{ archive.sourceCount }} 个来源</small>
        </span>
        <span class="asset-open">打开文件</span>
      </button>
    </section>
  </section>
</template>
