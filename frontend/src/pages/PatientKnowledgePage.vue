<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ReportRenderer from '../components/report/ReportRenderer.vue'
import { workspaceService } from '../services'
import { usePatientKnowledgeStore, useUiStore } from '../stores'
import type { WorkspaceAsset } from '../types/domain'
import type { Reference } from '../utils/report'

type PatientArchive = {
  id: string
  sessionId: string
  title: string
  files: WorkspaceAsset[]
  report?: WorkspaceAsset
  updatedAt: string
  researchFileCount: number
}

const knowledge = usePatientKnowledgeStore()
const ui = useUiStore()
const router = useRouter()
const search = ref('')
const selectedArchive = ref<PatientArchive | null>(null)
const selectedFile = ref<WorkspaceAsset | null>(null)
const documentContent = ref('')
const documentError = ref('')
const documentLoading = ref(false)
let documentReadSequence = 0

const archives = computed<PatientArchive[]>(() => {
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
      title: files[0]?.sessionTitle || report?.path.split('/').at(-1)?.replace(/\.md$/, '') || '未命名健康问题',
      files,
      report,
      updatedAt: files.reduce((latest, file) => latest > file.modified_at ? latest : file.modified_at, ''),
      researchFileCount: files.filter((file) => file.kind !== 'attachment').length,
    }
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  return query
    ? archives.value.filter((archive) => [archive.title, ...archive.files.map((file) => file.path)].join(' ').toLowerCase().includes(query))
    : archives.value
})
const reportCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind === 'report').length)
const researchFileCount = computed(() => knowledge.workspaceAssets.filter((asset) => asset.kind !== 'attachment').length)
const formatUpdatedAt = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
const documentKindLabel = (file: WorkspaceAsset) => ({
  report: '详细健康报告',
  report_draft: '报告草稿',
  research_frame: '研究记录',
  artifact: '分析资料',
  attachment: '上传附件',
}[file.kind])
const documentTitle = (file: WorkspaceAsset) => file.path.split('/').at(-1)?.replace(/\.md$/, '') || documentKindLabel(file)
const openDocument = async (archive: PatientArchive, file: WorkspaceAsset) => {
  const request = ++documentReadSequence
  selectedArchive.value = archive
  selectedFile.value = file
  documentContent.value = ''
  documentError.value = ''
  documentLoading.value = true
  try {
    const content = (await workspaceService.read(archive.sessionId, file.preview_path || file.path)).content
    if (request === documentReadSequence) documentContent.value = content
  } catch (error) {
    if (request === documentReadSequence) documentError.value = error instanceof Error ? error.message : '无法读取这份文档。'
  } finally {
    if (request === documentReadSequence) documentLoading.value = false
  }
}
const openArchive = (archive: PatientArchive) => {
  const file = archive.report
    || archive.files.find((item) => item.kind === 'report_draft')
    || archive.files.find((item) => item.kind !== 'attachment')
    || archive.files[0]
  if (file) void openDocument(archive, file)
}
const closeReader = () => {
  documentReadSequence += 1
  selectedArchive.value = null
  selectedFile.value = null
  documentContent.value = ''
  documentError.value = ''
  documentLoading.value = false
}
const openCitation = (reference: Reference) => {
  if (selectedArchive.value && selectedFile.value?.kind === 'report') {
    ui.openCitation(reference, { sessionId: selectedArchive.value.sessionId, reportPath: selectedFile.value.path })
    return
  }
  ui.openCitation(reference)
}

onMounted(() => { void knowledge.loadWorkspaceAssets() })
</script>

<template>
  <section class="asset-page patient-section-page" aria-label="患者健康报告库">
    <header class="asset-page-head">
      <div>
        <span>健康报告库</span>
        <h2>每个健康问题，都保留可核对的依据。</h2>
        <p>这里读取服务端已经归档的详细报告与研究记录，不依赖浏览器里的回答文本。</p>
      </div>
      <button class="asset-refresh" type="button" :disabled="knowledge.workspaceLoading" @click="knowledge.loadWorkspaceAssets()">
        {{ knowledge.workspaceLoading ? '正在同步…' : '刷新报告库' }}
      </button>
    </header>

    <div class="asset-summary" aria-label="患者报告库概览">
      <span><strong>{{ reportCount }}</strong> 份详细报告</span>
      <span><strong>{{ researchFileCount }}</strong> 份服务端文档</span>
    </div>

    <div class="asset-toolbar">
      <label>
        <span class="sr-only">搜索健康报告</span>
        <input v-model="search" type="search" placeholder="搜索健康问题、报告名称或研究记录">
      </label>
      <span>点击问题可阅读报告，并通过文中引用核验对应证据。</span>
    </div>

    <section v-if="knowledge.workspaceLoading" class="asset-empty">正在读取患者问答对应的服务端工作区…</section>
    <section v-else-if="!rows.length" class="asset-empty">
      <strong>还没有服务端报告</strong>
      <p>完成一次健康问答后，服务端归档的详细报告与研究记录会出现在这里。</p>
      <button type="button" @click="router.push('/patient')">开始健康问答</button>
    </section>
    <section v-else class="asset-list" aria-label="已归档健康问题">
      <button v-for="archive in rows" :key="archive.id" class="asset-project" type="button" @click="openArchive(archive)">
        <span class="asset-project-state">{{ archive.report ? '详细报告' : '研究归档' }}</span>
        <span class="asset-main">
          <strong>{{ archive.title }}</strong>
          <small>{{ archive.report ? '服务端正式报告已生成' : '服务端研究文档已归档' }} · {{ archive.researchFileCount }} 份研究文档</small>
          <span class="asset-project-meta">最近更新 {{ formatUpdatedAt(archive.updatedAt) }}</span>
        </span>
        <span class="asset-open">阅读报告</span>
      </button>
    </section>

    <section v-if="selectedArchive && selectedFile" class="asset-reader" aria-label="健康文档阅读区">
      <header class="asset-reader-head">
        <div>
          <span>{{ documentKindLabel(selectedFile) }}</span>
          <h3>{{ selectedArchive.title }}</h3>
          <small>{{ documentTitle(selectedFile) }}</small>
        </div>
        <button type="button" @click="closeReader">收起阅读区</button>
      </header>
      <nav v-if="selectedArchive.files.length > 1" class="asset-document-tabs" aria-label="本题服务端文档">
        <button
          v-for="file in selectedArchive.files"
          :key="file.path"
          type="button"
          :class="{ active: selectedFile.path === file.path }"
          @click="openDocument(selectedArchive!, file)"
        >{{ documentKindLabel(file) }}</button>
      </nav>
      <p v-if="documentLoading" class="asset-reader-state">正在打开服务端文档…</p>
      <p v-else-if="documentError" class="asset-reader-state error">{{ documentError }}</p>
      <ReportRenderer v-else-if="documentContent" :markdown="documentContent" audience="patient" @citation="openCitation" />
      <p v-else class="asset-reader-state">这份文档暂时没有可预览的文本内容。</p>
    </section>
  </section>
</template>
