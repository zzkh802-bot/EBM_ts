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

<style scoped>
.patient-health-answer {
  display: grid;
  gap: 14px;
  width: min(100%, 720px);
  padding: 18px;
  border: 1px solid rgba(176, 120, 58, .2);
  border-radius: 12px 12px 12px 3px;
  background: rgba(255, 253, 247, .82);
  box-shadow: 0 12px 28px rgba(112, 86, 48, .07);
}
.patient-answer-summary { display: grid; gap: 10px; }
.patient-answer-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--jade); font-family: var(--mono); font-size: 10px; letter-spacing: .08em; }
.patient-answer-meta strong { padding: 4px 7px; border: 1px solid rgba(176, 120, 58, .24); border-radius: 999px; color: var(--jade); font-size: 10px; font-weight: 600; letter-spacing: 0; }
.patient-health-answer h2 { margin: 0; color: var(--ink); font-family: var(--reading); font-size: 20px; font-weight: 600; letter-spacing: 0; line-height: 1.55; }
.patient-answer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.patient-action-card, .patient-risk-card { padding: 13px; border: 1px solid var(--line); border-radius: 9px; background: rgba(255, 255, 255, .5); }
.patient-action-card header, .patient-risk-card header { display: flex; align-items: center; gap: 8px; }
.patient-action-card header > span, .patient-risk-card header > span { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; background: rgba(176, 120, 58, .11); color: var(--jade); font-family: var(--mono); font-size: 11px; font-weight: 700; }
.patient-risk-card header > span { background: rgba(200, 154, 69, .14); color: var(--amber); }
.patient-health-answer h3 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 650; }
.patient-action-card ol, .patient-risk-card ul, .patient-follow-up ul { display: grid; gap: 7px; padding-left: 1.25em; margin: 11px 0 0; }
.patient-action-card li, .patient-risk-card li, .patient-follow-up li { color: var(--ink-soft); font-family: var(--reading); font-size: 13px; line-height: 1.65; }
.patient-risk-card { border-color: rgba(200, 154, 69, .25); background: rgba(255, 250, 239, .7); }
.patient-urgent-banner { display: grid; gap: 5px; padding: 12px 13px; border-left: 3px solid var(--danger); background: rgba(176, 79, 69, .08); color: var(--ink-soft); }
.patient-urgent-banner strong { color: var(--danger); font-size: 13px; }
.patient-urgent-banner span { font-family: var(--reading); font-size: 13px; line-height: 1.65; }
.patient-care-timing { padding: 12px 13px; border-left: 2px solid var(--jade); background: rgba(176, 120, 58, .065); }
.patient-care-timing > span, .patient-follow-up header span { display: block; color: var(--jade); font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: .08em; }
.patient-care-timing p { margin: 6px 0 0; color: var(--ink-soft); font-family: var(--reading); font-size: 13px; line-height: 1.7; }
.patient-follow-up { padding-top: 2px; }
.patient-follow-up header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.patient-follow-up header small { color: var(--ink-faint); font-size: 11px; }
.patient-uncertainty { padding-top: 11px; border-top: 1px solid var(--line); color: var(--ink-faint); }
.patient-uncertainty summary { cursor: pointer; font-size: 11px; }
.patient-uncertainty p { margin: 8px 0 0; color: var(--ink-faint); font-family: var(--reading); font-size: 12px; line-height: 1.7; }
.safety-prompt_medical_review .patient-answer-meta strong { border-color: rgba(200, 154, 69, .32); color: var(--amber); }
.safety-urgent .patient-answer-meta strong, .safety-emergency .patient-answer-meta strong { border-color: rgba(176, 79, 69, .32); color: var(--danger); }

@media (max-width: 860px) {
  .patient-health-answer { width: 100%; padding: 15px; }
  .patient-answer-grid { grid-template-columns: 1fr; }
}
</style>
