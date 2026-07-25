<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
const route = useRoute()
const router = useRouter()
const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
</script>

<template>
  <nav class="bottom-nav" aria-label="底部导航">
    <button class="nav-item" :class="{ active: isActive('/knowledge') }" type="button" aria-label="我的知识" @click="router.push('/knowledge')">
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4h12v16H6zM9 7h6M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
      <span>我的知识</span>
    </button>
    <button class="nav-item" :class="{ active: isActive('/evidence') }" type="button" aria-label="循证" @click="router.push('/evidence')">
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h7l4 4v12H7zM14 4v4h4M9.5 14.5l2 2 4-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span>循证</span>
    </button>
    <button class="nav-item" :class="{ active: isActive('/literature') }" type="button" aria-label="文献速递" @click="router.push('/literature')">
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h11v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 0v16M10 8h5M10 12h5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
      <span>文献速递</span>
    </button>
  </nav>
</template>
