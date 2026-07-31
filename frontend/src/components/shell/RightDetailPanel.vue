<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUiStore } from '../../stores'
import { workspaceService } from '../../services'
import type { WorkspaceFile } from '../../types/domain'
import type { Reference } from '../../utils/report'
import { copyText, safeExternalUrl } from '../../utils/browser'
import ReportRenderer from '../report/ReportRenderer.vue'

const ui = useUiStore()
const record = computed<Record<string, unknown>>(() =>
  ui.detailPayload && typeof ui.detailPayload === 'object' ? ui.detailPayload as Record<string, unknown> : {})
const citation = computed(() => record.value as unknown as Reference)
const archive = computed(() => {
  const data = record.value
  const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : {}
  return {
    run: data.run || data.archive || result.run,
    answer: data.answer || data.report_markdown || data.agent_answer || result.answer || result.report_markdown,
    stats: data.stats || data.summary || result.stats || result.summary,
    items: data.items || data.evidence_items || result.items || result.evidence_items,
  }
})
const raw = computed(() => JSON.stringify(ui.detailPayload, null, 2))
const workspace = computed(() => {
  const data = record.value
  return {
    sessionId: typeof data.session_id === 'string' ? data.session_id : '',
    files: Array.isArray(data.files) ? data.files as WorkspaceFile[] : [],
    loading: data.loading === true,
    error: typeof data.error === 'string' ? data.error : '',
  }
})
const selectedWorkspaceFile = ref<WorkspaceFile | null>(null)
const workspaceFileContent = ref('')
const workspaceFileError = ref('')
watch(() => [ui.detailOpen, ui.detailKind], () => {
  selectedWorkspaceFile.value = null
  workspaceFileContent.value = ''
  workspaceFileError.value = ''
})
const openWorkspaceFile = async (file: WorkspaceFile) => {
  if (!workspace.value.sessionId) return
  selectedWorkspaceFile.value = file
  workspaceFileContent.value = ''
  workspaceFileError.value = ''
  try {
    workspaceFileContent.value = (await workspaceService.read(workspace.value.sessionId, file.path)).content
  } catch (error) {
    workspaceFileError.value = error instanceof Error ? error.message : '无法读取该文件。'
  }
}
</script>

<template>
  <div class="citation-backdrop" :hidden="!ui.detailOpen" data-citation-close @click="ui.detailOpen = false" />
  <aside class="citation-sheet" :aria-hidden="!ui.detailOpen" aria-label="引用内容">
    <div class="citation-head">
      <strong>{{ ui.detailTitle || '引用内容' }}</strong>
      <button class="citation-close" type="button" aria-label="关闭引用内容" @click="ui.detailOpen = false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <div class="citation-source-meta">
      <template v-if="ui.detailKind === 'citation'">
        <div class="citation-meta-row">
          <span v-if="citation.pmid">PMID {{ citation.pmid }}</span>
          <span v-if="citation.url">外链</span>
        </div>
      </template>
    </div>
    <div class="citation-body">
      <template v-if="ui.detailKind === 'citation'">
        <div class="citation-source-card">
          <strong>{{ citation.title }}</strong>
          <p>{{ citation.content }}</p>
        </div>
      </template>
      <template v-else-if="ui.detailKind === 'archive'">
        <details><summary>运行信息</summary><pre>{{ JSON.stringify(archive.run, null, 2) }}</pre></details>
        <details v-if="archive.answer" open><summary>本轮回答</summary><p class="pre-line">{{ archive.answer }}</p></details>
        <details v-if="archive.stats"><summary>研究统计</summary><pre>{{ JSON.stringify(archive.stats, null, 2) }}</pre></details>
        <details v-if="archive.items"><summary>证据条目</summary><pre>{{ JSON.stringify(archive.items, null, 2) }}</pre></details>
      </template>
      <template v-else-if="ui.detailKind === 'workspace'">
        <p v-if="workspace.loading">正在读取本次研究生成的文件…</p>
        <p v-else-if="workspace.error">{{ workspace.error }}</p>
        <p v-else-if="!workspace.files.length">本次对话尚未生成可展示的研究文件。</p>
        <div v-else class="workspace-file-list">
          <button v-for="file in workspace.files" :key="file.path" type="button" :class="{ active: selectedWorkspaceFile?.path === file.path }" @click="openWorkspaceFile(file)">
            <span>{{ file.kind === 'research_frame' ? '研究框架' : file.kind === 'report' ? '正式报告' : file.kind === 'evidence' ? '证据记录' : '来源归档' }}</span>
            <strong>{{ file.path }}</strong>
          </button>
        </div>
        <section v-if="selectedWorkspaceFile" class="workspace-file-content">
          <strong>{{ selectedWorkspaceFile.path }}</strong>
          <p v-if="workspaceFileError">{{ workspaceFileError }}</p>
          <ReportRenderer v-else-if="workspaceFileContent && selectedWorkspaceFile.kind === 'report'" :markdown="workspaceFileContent" audience="clinician" @citation="ui.openCitation" />
          <pre v-else-if="workspaceFileContent">{{ workspaceFileContent }}</pre>
          <p v-else>正在打开文件…</p>
        </section>
      </template>
      <pre v-else>{{ raw }}</pre>
      <details class="archive-raw"><summary>查看 raw JSON</summary><pre>{{ raw }}</pre></details>
    </div>
    <div class="citation-actions">
      <a v-if="ui.detailKind === 'citation' && safeExternalUrl(citation.url)" class="pill-button primary" :href="safeExternalUrl(citation.url)" target="_blank" rel="noreferrer noopener">打开原文</a>
      <a v-if="ui.detailKind === 'citation' && citation.pmid" class="pill-button" :href="`https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`" target="_blank" rel="noreferrer noopener">打开 PMID</a>
      <button type="button" class="pill-button" @click="copyText(raw)">复制 JSON</button>
      <button type="button" data-citation-close @click="ui.detailOpen = false">关闭</button>
    </div>
  </aside>
</template>
