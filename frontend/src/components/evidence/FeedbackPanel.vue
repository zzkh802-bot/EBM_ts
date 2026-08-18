<script setup lang="ts">
import { computed, ref } from 'vue'
import { feedbackService } from '../../services/feedback'
import type { FeedbackRubric } from '../../types/domain'

const props = defineProps<{ sessionId: string; runId: string }>()
const emit = defineEmits<{ closed: [] }>()
const rubricDefinitions: Array<{ key: FeedbackRubric; label: string }> = [
  { key: 'requirement_understanding', label: '智能体正确理解了我的需求' },
  { key: 'clinical_interpretation_accuracy', label: '智能体对临床问题的理解准确' },
  { key: 'subquestion_decomposition', label: '临床子问题拆分合理，覆盖了关键决策点' },
  { key: 'evidence_support', label: '指南/文献引用足以支持问题的回答' },
  { key: 'report_trustworthiness', label: '报告可信，没有明显编造事实或超出证据断言' },
  { key: 'report_completeness', label: '报告完整，没有缺少必要的假设验证或边界' },
  { key: 'report_clarity', label: '报告清晰、可读，对人类读者友好' },
  { key: 'ebm_standard_compliance', label: '报告符合循证规范，引用可以回溯' },
  { key: 'time_worth', label: '综合结果和等待时间，这次使用值得' },
]
const values = ref<Partial<Record<FeedbackRubric, number>>>({})
const comment = ref('')
const submitted = ref(false)
const dismissed = ref(false)
const pending = ref(false)
const error = ref('')
const complete = computed(() => rubricDefinitions.every((item) => values.value[item.key] !== undefined))

const choose = (key: FeedbackRubric, value: number) => { values.value[key] = value }
const submit = async () => {
  if (!complete.value || pending.value || submitted.value) return
  pending.value = true
  error.value = ''
  try {
    await feedbackService.submit(props.sessionId, props.runId, values.value, comment.value)
    submitted.value = true
    emit('closed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '反馈提交失败'
  } finally {
    pending.value = false
  }
}

const dismiss = () => {
  if (!pending.value && !submitted.value) { dismissed.value = true; emit('closed') }
}
</script>

<template>
  <section v-if="!dismissed" class="feedback-panel" aria-label="本轮研究反馈">
    <div class="feedback-panel-head">
      <span>本轮反馈</span>
      <button v-if="!submitted" class="feedback-dismiss" type="button" aria-label="关闭本轮问卷" @click="dismiss">暂不填写</button>
      <small v-if="submitted">已记录，谢谢</small>
      <small v-else>请按这份报告是否符合描述评分：1 = 完全不符合，5 = 完全符合</small>
    </div>
    <p v-if="!submitted" class="feedback-note">只评价这份最终报告及其使用价值，不需要评价模型内部检索过程。</p>
    <div v-if="!submitted" class="feedback-rubrics">
      <div v-for="item in rubricDefinitions" :key="item.key" class="feedback-rubric">
        <span>{{ item.label }}</span>
        <div class="feedback-scale" role="group" :aria-label="item.label">
          <button v-for="score in [1, 2, 3, 4, 5]" :key="score" type="button" :class="{ selected: values[item.key] === score }" @click="choose(item.key, score)">{{ score }}</button>
        </div>
      </div>
    </div>
    <details v-if="!submitted" class="feedback-comment">
      <summary>补充自然语言反馈（可选）</summary>
      <textarea v-model="comment" maxlength="4000" placeholder="如发现疑似编造、引用与结论不一致，或遗漏了必要的假设/边界，请指出具体位置；也可说明哪一段最有帮助。" />
    </details>
    <p v-if="error" class="feedback-error">{{ error }}</p>
    <button v-if="!submitted" class="feedback-submit" type="button" :disabled="pending || !complete" @click="submit">{{ pending ? '记录中…' : '提交反馈' }}</button>
  </section>
</template>

<style scoped>
.feedback-panel { margin-top: 18px; padding: 14px 15px; border: 1px solid rgba(49, 86, 200, .2); border-radius: 10px; background: rgba(230, 239, 255, .62); }
.feedback-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 11px; color: var(--ink, #172535); }
.feedback-panel-head span { font-weight: 700; }
.feedback-panel-head small { color: var(--ink-faint, #8a959b); }
.feedback-dismiss { margin-left: auto; padding: 2px 0; border: 0; background: transparent; color: var(--ink-faint, #8a959b); cursor: pointer; font-size: 11px; }
.feedback-dismiss:hover { color: var(--ink, #172535); text-decoration: underline; }
.feedback-note { margin: -4px 0 11px; color: var(--ink-faint, #7d888d); font-size: 11px; }
.feedback-rubrics { display: grid; gap: 9px; }
.feedback-rubric { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ink-soft, #56636f); font-size: 12px; }
.feedback-scale { display: flex; gap: 4px; }
.feedback-scale button { min-width: 34px; padding: 4px 7px; border: 1px solid rgba(49, 86, 200, .22); border-radius: 5px; background: rgba(255, 255, 255, .7); color: var(--ink-soft, #56636f); cursor: pointer; }
.feedback-scale button.selected { background: var(--jade, #3156c8); color: #fff; }
.feedback-comment { margin-top: 11px; color: var(--ink-soft, #56636f); font-size: 12px; }
.feedback-comment textarea { box-sizing: border-box; width: 100%; min-height: 68px; margin-top: 8px; padding: 8px; border: 1px solid rgba(23, 37, 53, .16); border-radius: 6px; background: #fff; resize: vertical; }
.feedback-submit { margin-top: 11px; padding: 7px 11px; border: 0; border-radius: 6px; background: var(--jade, #3156c8); color: #fff; cursor: pointer; font-size: 12px; }
.feedback-submit:disabled { cursor: not-allowed; opacity: .5; }
.feedback-error { margin: 8px 0 0; color: #a43d36; font-size: 12px; }
</style>
