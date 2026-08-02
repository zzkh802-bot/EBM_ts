<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { workspaceService } from '../services'
import { useKnowledgeStore } from '../stores'
import type { WorkspaceAsset } from '../types/domain'
import ReportRenderer from '../components/report/ReportRenderer.vue'

type ResearchArchive = {
  id: string
  sessionId: string
  title: string
  files: WorkspaceAsset[]
  report?: WorkspaceAsset
  updatedAt: string
  frameCount: number
}

const knowledge = useKnowledgeStore()
const router = useRouter()
const search = ref('')
const selectedArchive = ref<ResearchArchive | null>(null)
const selectedFile = ref<WorkspaceAsset | null>(null)
const documentContent = ref('')
const documentError = ref('')
const documentLoading = ref(false)
let documentReadSequence = 0

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
      frameCount: files.filter((file) => file.kind === 'research_frame').length,
    }
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return archives.value
  return archives.value.filter((archive) => [archive.title, ...archive.files.map((file) => file.path)].join(' ').toLowerCase().includes(query))
})
const reportCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'report').length)
const frameCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'research_frame').length)
const formatUpdatedAt = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
const documentKindLabel = (file: WorkspaceAsset) => file.kind === 'report' ? '最终报告' : '研究框架'
const documentTitle = (file: WorkspaceAsset) => file.path.split('/').at(-1)?.replace(/\.md$/, '') || documentKindLabel(file)
const openDocument = async (archive: ResearchArchive, file: WorkspaceAsset) => {
  const request = ++documentReadSequence
  selectedArchive.value = archive
  selectedFile.value = file
  documentContent.value = ''
  documentError.value = ''
  documentLoading.value = true
  try {
    const content = (await workspaceService.read(archive.sessionId, file.path)).content
    if (request === documentReadSequence) documentContent.value = content
  } catch (error) {
    if (request === documentReadSequence) documentError.value = error instanceof Error ? error.message : '无法读取该文档。'
  } finally {
    if (request === documentReadSequence) documentLoading.value = false
  }
}
const openArchive = (archive: ResearchArchive) => {
  const file = archive.report || archive.files[0]
  if (file) void openDocument(archive, file)
}

onMounted(() => { void knowledge.loadWorkspaceAssets() })
</script>

<template>
  <section class="asset-page" aria-label="研究报告库">
    <header class="asset-page-head">
      <div>
        <span>研究报告库</span>
        <h2>每个临床问题，都有可续写的研究记录。</h2>
        <p>按临床问题回看最终报告与研究框架，继续追踪时可沿用原有研究上下文。</p>
      </div>
      <button class="asset-refresh" type="button" :disabled="knowledge.workspaceLoading" @click="knowledge.loadWorkspaceAssets()">
        {{ knowledge.workspaceLoading ? '正在同步…' : '刷新报告库' }}
      </button>
    </header>

    <div class="asset-summary" aria-label="报告库概览">
      <span><strong>{{ reportCount }}</strong> 正式报告</span>
      <span><strong>{{ frameCount }}</strong> 研究框架</span>
    </div>

    <div class="asset-toolbar">
      <label>
        <span class="sr-only">搜索研究报告</span>
        <input v-model="search" type="search" placeholder="搜索临床问题、报告标题或研究框架">
      </label>
      <span>点击问题即可阅读最终报告或研究框架。</span>
    </div>

    <section v-if="knowledge.workspaceLoading" class="asset-empty">正在读取各会话的研究工作区…</section>
    <section v-else-if="!rows.length" class="asset-empty">
      <strong>还没有正式报告</strong>
      <p>完成一次循证研究后，最终报告与研究框架会自动出现在这里。</p>
      <button type="button" @click="router.push('/evidence')">开始循证研究</button>
    </section>
    <section v-else class="asset-list" aria-label="已完成循证研究">
      <button v-for="archive in rows" :key="archive.id" class="asset-project" type="button" @click="openArchive(archive)">
        <span class="asset-project-state">{{ archive.report ? '正式报告' : '研究归档' }}</span>
        <span class="asset-main">
          <strong>{{ archive.title }}</strong>
          <small>{{ archive.report ? '最终报告已生成' : '研究框架已归档' }} · {{ archive.frameCount }} 份研究框架</small>
          <span class="asset-project-meta">最近更新 {{ formatUpdatedAt(archive.updatedAt) }}</span>
        </span>
        <span class="asset-open">阅读报告</span>
      </button>
    </section>

    <section v-if="selectedArchive && selectedFile" class="asset-reader" aria-label="研究文档阅读区">
      <header class="asset-reader-head">
        <div>
          <span>{{ documentKindLabel(selectedFile) }}</span>
          <h3>{{ selectedArchive.title }}</h3>
          <small>{{ documentTitle(selectedFile) }}</small>
        </div>
        <button type="button" @click="selectedArchive = null; selectedFile = null; documentReadSequence += 1">收起阅读区</button>
      </header>
      <nav v-if="selectedArchive.files.length > 1" class="asset-document-tabs" aria-label="本题文档">
        <button
          v-for="file in selectedArchive.files"
          :key="file.path"
          type="button"
          :class="{ active: selectedFile.path === file.path }"
          @click="openDocument(selectedArchive!, file)"
        >{{ documentKindLabel(file) }}</button>
      </nav>
      <p v-if="documentLoading" class="asset-reader-state">正在打开文档…</p>
      <p v-else-if="documentError" class="asset-reader-state error">{{ documentError }}</p>
      <ReportRenderer v-else-if="documentContent" :markdown="documentContent" audience="clinician" />
    </section>
  </section>
</template>
