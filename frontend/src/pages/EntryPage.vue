<script setup lang="ts">
import { useRouter } from 'vue-router'
import { PATIENT_INTAKE_ENABLED } from '../config/features'

const router = useRouter()
</script>

<template>
  <main class="entry-page">
    <header class="entry-head">
      <div class="entry-brand"><span class="entry-mark">循</span><span>循医</span></div>
      <small>让一次就医，从被理解开始</small>
    </header>
    <section class="entry-stage" aria-labelledby="entry-title">
      <p class="entry-kicker">CHOOSE YOUR SPACE</p>
      <h1 id="entry-title">你想从哪里开始？</h1>
      <p class="entry-lede">问一个日常健康问题，或进入临床循证工作台。</p>
      <div class="entry-choices">
        <button class="entry-choice clinician" type="button" @click="router.push('/clinician')">
          <span class="entry-choice-icon" aria-hidden="true">⌁</span>
          <span class="entry-choice-overline">循证研究</span>
          <strong>我是医生</strong>
          <p>持续追踪临床问题，检索、核验并形成可复核的正式报告。</p>
          <em>进入工作台</em>
        </button>
        <button
          class="entry-choice patient"
          type="button"
          :disabled="!PATIENT_INTAKE_ENABLED"
          @click="router.push('/patient/intake')"
        >
          <span class="entry-choice-icon" aria-hidden="true">↗</span>
          <span class="entry-choice-overline">健康快速问答</span>
          <strong>健康问答</strong>
          <p>用容易理解的方式解答日常健康疑问，必要时提示何时该线下就医。</p>
          <em>{{ PATIENT_INTAKE_ENABLED ? '开始提问' : '暂未开放' }}</em>
        </button>
      </div>
    </section>
    <footer class="entry-foot">
      循医不会替代医生的判断；它帮助每一次沟通更清楚。
    </footer>
  </main>
</template>
