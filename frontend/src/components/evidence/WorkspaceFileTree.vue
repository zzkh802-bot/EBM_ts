<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceFile } from '../../types/domain'

type Folder = { name: string; path: string; folders: Map<string, Folder>; files: WorkspaceFile[] }
type Entry = { type: 'folder'; name: string; path: string; depth: number } | { type: 'file'; file: WorkspaceFile; depth: number }

const props = defineProps<{ files: WorkspaceFile[]; title: string; selectedPath?: string }>()
const emit = defineEmits<{ select: [file: WorkspaceFile] }>()

const entries = computed<Entry[]>(() => {
  const root: Folder = { name: '', path: '', folders: new Map(), files: [] }
  for (const file of props.files) {
    const parts = file.path.split('/')
    parts.pop()
    let folder = root
    for (const part of parts) {
      const path = folder.path ? `${folder.path}/${part}` : part
      let child = folder.folders.get(part)
      if (!child) {
        child = { name: part, path, folders: new Map(), files: [] }
        folder.folders.set(part, child)
      }
      folder = child
    }
    folder.files.push(file)
  }
  const order = (name: string) => ['reports', 'notes', 'evidence', 'sources'].indexOf(name)
  const result: Entry[] = []
  const add = (folder: Folder, depth: number) => {
    for (const child of [...folder.folders.values()].sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name))) {
      result.push({ type: 'folder', name: child.name, path: child.path, depth })
      add(child, depth + 1)
    }
    for (const file of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) result.push({ type: 'file', file, depth })
  }
  add(root, 0)
  return result
})
</script>

<template>
  <aside class="workspace-tree" aria-label="研究文件目录">
    <div class="workspace-tree-head"><span>研究文件</span><small>{{ files.length }} 个文件</small></div>
    <div class="workspace-tree-root">{{ title || '本次研究' }}</div>
    <template v-for="entry in entries" :key="entry.type === 'folder' ? entry.path : entry.file.path">
      <span v-if="entry.type === 'folder'" class="workspace-tree-folder" :style="{ paddingLeft: `${12 + entry.depth * 14}px` }">{{ entry.name }}</span>
      <button v-else class="workspace-tree-file" :class="{ active: selectedPath === entry.file.path }" type="button" :style="{ paddingLeft: `${12 + entry.depth * 14}px` }" @click="emit('select', entry.file)">{{ entry.file.path.split('/').at(-1) }}</button>
    </template>
  </aside>
</template>
