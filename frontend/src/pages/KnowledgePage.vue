<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useKnowledgeStore, useUiStore } from '../stores'
import type { WorkspaceAsset } from '../types/domain'

const knowledge = useKnowledgeStore()
const ui = useUiStore()
const router = useRouter()
const search = ref('')

const kindLabel = (kind: WorkspaceAsset['kind']) => ({ report: '正式报告', research_frame: '研究框架', evidence: '证据记录', source: '来源归档' }[kind])
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
const locationLabel = (asset: WorkspaceAsset) => `${asset.path.split('/').slice(0, -1).join(' / ')} · ${asset.sessionTitle}`
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return knowledge.workspaceAssets
  return knowledge.workspaceAssets.filter((asset) => [asset.path, asset.sessionTitle, kindLabel(asset.kind)].join(' ').toLowerCase().includes(query))
})
const reportCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'report').length)
const sourceCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'source').length)
const evidenceCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'evidence').length)
const openAsset = (asset: WorkspaceAsset) => {
  ui.openDetail(asset.sessionTitle, { session_id: asset.sessionId, files: [asset], preferred_path: asset.path }, 'workspace')
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
        <input v-model="search" type="search" placeholder="搜索报告、研究问题或来源文件">
      </label>
      <span>仅显示已由后端归档的真实文件</span>
    </div>

    <section v-if="knowledge.workspaceLoading" class="asset-empty">正在读取各会话的研究工作区…</section>
    <section v-else-if="!rows.length" class="asset-empty">
      <strong>还没有研究资产</strong>
      <p>完成一次循证研究后，正式报告、研究框架和证据文件会自动出现在这里。</p>
      <button type="button" @click="router.push('/evidence')">开始循证研究</button>
    </section>
    <section v-else class="asset-list" aria-label="已归档研究文件">
      <button v-for="asset in rows" :key="asset.id" class="asset-row" type="button" @click="openAsset(asset)">
        <span class="asset-kind">{{ kindLabel(asset.kind) }}</span>
        <span class="asset-main">
          <strong>{{ asset.path.split('/').at(-1) }}</strong>
          <small>{{ locationLabel(asset) }}</small>
        </span>
        <span class="asset-meta">{{ formatBytes(asset.size) }}</span>
      </button>
    </section>
  </section>
</template>
