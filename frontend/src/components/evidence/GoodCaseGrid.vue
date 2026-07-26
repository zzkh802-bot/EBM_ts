<script setup lang="ts">
import { goodCases } from '../../data/goodCases'
defineEmits<{ select: [question: string] }>()
</script>

<template>
  <div class="good-cases">
    <div><strong>循证 Good Cases</strong><small>来自跨科室正式标记 good_case 的完整检索与引用链案例</small></div>
    <button v-for="item in goodCases" :key="item.id" :data-case-id="item.id" @click="$emit('select', item.question)">
      <span><em>{{ item.department }}</em><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><b>填入对话框</b>
    </button>
  </div>
</template>
