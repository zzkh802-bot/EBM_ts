<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'

const props = defineProps<{ src: string; title: string }>()

const host = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref('')
let renderSequence = 0
let activeDocument: { destroy: () => Promise<void> } | undefined
const MAX_RENDERED_PAGES = 40

const renderDocument = async () => {
  const sequence = ++renderSequence
  loading.value = true
  error.value = ''
  if (host.value) host.value.replaceChildren()
  await activeDocument?.destroy().catch(() => undefined)
  activeDocument = undefined
  try {
    const response = await fetch(props.src, { credentials: 'include' })
    if (!response.ok) throw new Error(`原件读取失败（${response.status}）`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
    const document = await pdfjs.getDocument({ data: bytes }).promise
    activeDocument = document
    await nextTick()
    if (sequence !== renderSequence || !host.value) return
    const pageLimit = Math.min(document.numPages, MAX_RENDERED_PAGES)
    if (document.numPages > MAX_RENDERED_PAGES) {
      error.value = `该 PDF 共 ${document.numPages} 页，当前仅预览前 ${MAX_RENDERED_PAGES} 页；请下载原件查看全部内容。`
    }
    const width = Math.max(host.value.clientWidth - 32, 320)
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = Math.max(width / baseViewport.width, 1)
      const viewport = page.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) continue
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.ceil(viewport.width * pixelRatio)
      canvas.height = Math.ceil(viewport.height * pixelRatio)
      canvas.style.width = `${Math.ceil(viewport.width)}px`
      canvas.style.height = `${Math.ceil(viewport.height)}px`
      canvas.setAttribute('aria-label', `${props.title} 第 ${pageNumber} 页`)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      await page.render({ canvasContext: context, canvas, viewport }).promise
      if (sequence !== renderSequence || !host.value) return
      host.value.append(canvas)
    }
  } catch (cause) {
    if (sequence === renderSequence) error.value = cause instanceof Error ? cause.message : '无法显示 PDF 原件。'
  } finally {
    if (sequence === renderSequence) loading.value = false
  }
}

onMounted(() => { void renderDocument() })
watch(() => props.src, () => { void renderDocument() })
onBeforeUnmount(() => {
  renderSequence += 1
  void activeDocument?.destroy()
  activeDocument = undefined
})
</script>

<template>
  <div class="pdf-document-viewer" :aria-label="title">
    <p v-if="loading" class="pdf-document-state">正在展开 PDF 原件…</p>
    <p v-else-if="error" class="pdf-document-state error">{{ error }}</p>
    <div ref="host" class="pdf-document-pages" />
  </div>
</template>

<style scoped>
.pdf-document-viewer { min-height: 220px; padding: 16px; background: #e8eceb; }
.pdf-document-pages { display: grid; justify-items: center; gap: 18px; }
.pdf-document-pages canvas { display: block; max-width: 100%; height: auto; background: #fff; box-shadow: 0 5px 17px rgba(25, 45, 58, .18); }
.pdf-document-state { padding: 36px 0; margin: 0; color: var(--ink-faint); text-align: center; }
.pdf-document-state.error { color: var(--danger); }
</style>
