<script setup lang="ts">
import { computed } from 'vue'
import type { PatientHealthAnswer, PatientSafetyLevel } from '../../types/domain'

const props = defineProps<{ answer: PatientHealthAnswer }>()

const safetyCopy: Record<PatientSafetyLevel, string> = {
  routine: '可先按建议观察',
  clarification_needed: '还需要补充信息',
  prompt_medical_review: '建议安排就医评估',
  urgent: '需要尽快就医',
  emergency: '需要立即求助',
}

const safetyLabel = computed(() => safetyCopy[props.answer.safety.level])
const urgent = computed(() => ['urgent', 'emergency'].includes(props.answer.safety.level))
</script>

<template>
  <article class="patient-health-answer" :class="`safety-${answer.safety.level}`">
    <header class="patient-answer-summary">
      <div class="patient-answer-meta">
        <span>基于当前信息</span>
        <strong>{{ safetyLabel }}</strong>
      </div>
      <h2>{{ answer.bottom_line }}</h2>
    </header>

    <section v-if="urgent" class="patient-urgent-banner" role="alert">
      <strong>{{ answer.safety.level === 'emergency' ? '现在优先处理安全问题' : '不要继续在家等待判断' }}</strong>
      <span>{{ answer.when_to_seek_care }}</span>
    </section>

    <div v-if="answer.actions.length || answer.red_flags.length" class="patient-answer-grid">
      <section v-if="answer.actions.length" class="patient-action-card">
        <header><span aria-hidden="true">✓</span><h3>现在可以做什么</h3></header>
        <ol>
          <li v-for="action in answer.actions" :key="action">{{ action }}</li>
        </ol>
      </section>
      <section v-if="answer.red_flags.length" class="patient-risk-card">
        <header><span aria-hidden="true">!</span><h3>出现这些情况要警惕</h3></header>
        <ul>
          <li v-for="flag in answer.red_flags" :key="flag">{{ flag }}</li>
        </ul>
      </section>
    </div>

    <section v-if="!urgent" class="patient-care-timing">
      <span>何时需要就医</span>
      <p>{{ answer.when_to_seek_care }}</p>
    </section>

    <section v-if="answer.follow_up_questions.length" class="patient-follow-up">
      <header>
        <span>为了判断得更准确</span>
        <small>可以继续告诉我</small>
      </header>
      <ul>
        <li v-for="question in answer.follow_up_questions" :key="question">{{ question }}</li>
      </ul>
    </section>

    <details class="patient-uncertainty">
      <summary>这份回答有哪些边界？</summary>
      <p>{{ answer.uncertainty }}</p>
    </details>
  </article>
</template>
