<script setup lang="ts">
import { goodCases } from '../../data/goodCases'
defineEmits<{ select: [question: string] }>()
</script>

<template>
  <div class="good-cases">
    <div><strong>循证示例</strong><small>按科室选择一个完整案例，也可以在输入框中继续修改问题</small></div>
    <button v-for="item in goodCases" :key="item.id" :data-case-id="item.id" @click="$emit('select', item.question)">
      <span><em>{{ item.department }}</em><strong>{{ item.title }}</strong><small>{{ item.summary }}</small></span><b>填入对话框</b>
    </button>
  </div>
</template>
