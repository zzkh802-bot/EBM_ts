import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PatientIntakePage from '../pages/PatientIntakePage.vue'
import { createAppRouter } from '../router'
import { agentService } from '../services'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('患者健康问答页面', () => {
  it('uses the expert research contract and renders both the health answer and detailed report', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(agentService, 'getRuntimeConfig').mockResolvedValue({
      default_provider: 'test-provider',
      default_model: 'test-model',
      feedback_enabled: false,
      models: [{
        provider: 'test-provider', provider_label: '测试服务', model: 'test-model',
        model_label: '测试模型', available: true,
      }],
    })
    const run = vi.spyOn(agentService, 'run').mockResolvedValue({
      contract_version: 'xunyi-research/v1',
      run_id: 'patient-run-1',
      query_id: 'patient-query-1',
      status: 'succeeded',
      session_id: 'patient-research-1',
      agent_answer: '{"bottom_line":"当前可以先观察。"}',
      patient_health: {
        contract_version: 'xunyi-patient-health/v1',
        status: 'answered',
        bottom_line: '当前可以先观察，但出现危险信号时应及时就医。',
        actions: ['记录症状变化'],
        red_flags: ['出现明显呼吸困难'],
        when_to_seek_care: '症状加重或出现危险信号时及时就医。',
        follow_up_questions: [],
        uncertainty: '仍缺少症状持续时间。',
        safety: { level: 'routine', needs_urgent_care: false },
      },
      report_markdown: '## 详细依据\n\n这是可核对的报告正文。',
      report_path: 'reports/patient-report.md',
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/patient/intake')
    await router.isReady()
    const wrapper = mount(PatientIntakePage, { global: { plugins: [pinia, router] } })
    await flushPromises()

    await wrapper.findAll('.patient-mode-switch button')[1]!.trigger('click')
    await wrapper.get('textarea[aria-label="健康问题"]').setValue('最近总是头痛，哪些情况需要尽快就医？')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      audience_mode: 'patient', research_mode: 'expert', thinking_level: 'high',
      response_mode: 'report', search_enabled: true,
    }), expect.any(AbortSignal), expect.any(Object))
    expect(wrapper.text()).toContain('当前可以先观察，但出现危险信号时应及时就医。')
    expect(wrapper.text()).toContain('这是可核对的报告正文。')
    expect(wrapper.get('.message-mode').text()).toBe('专家模式')
  })
})
