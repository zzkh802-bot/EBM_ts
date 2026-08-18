<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { healthService } from '../../services'
import { useUiStore } from '../../stores'

const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const serviceStatus = ref('检测中')

const workspaceLabel = computed(() => {
  if (route.path.startsWith('/clinician/knowledge')) return '研究报告库'
  return '循证工作台'
})

onMounted(async () => {
  try {
    const result = await healthService.check()
    serviceStatus.value = result.ok === false ? '离线' : '在线'
  } catch {
    serviceStatus.value = '离线'
  }
})
</script>

<template>
  <div class="app-top">
    <div class="app-brand">
      <button class="icon-button" type="button" aria-label="打开用户与历史列表" @click="ui.sessionDrawerOpen = true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
      <svg class="dp-logo-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect class="dp-logo-sheet" x="14" y="8" width="36" height="48" rx="8" /><path class="dp-logo-check" d="M22 22l7 7 14-15" /><path class="dp-logo-pulse" d="M19 38h8l4-10 6 19 5-12h7" /><circle class="dp-logo-node" cx="50" cy="48" r="5" /></svg>
      <div class="brand-copy">
        <span>循医</span>
        <small>{{ workspaceLabel }}</small>
      </div>
    </div>
    <div class="top-actions">
      <span class="service-status" :class="{ offline: serviceStatus === '离线', checking: serviceStatus === '检测中' }" :title="`循医服务：${serviceStatus}`">
        <i aria-hidden="true" />{{ serviceStatus }}
      </span>
      <button class="icon-button" type="button" aria-label="新建临床问题" @click="router.push('/clinician')">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7v6m-3-3h6M7.5 19.5 4 21l1.2-3.7A8 8 0 1 1 7.5 19.5Z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  </div>
</template>
