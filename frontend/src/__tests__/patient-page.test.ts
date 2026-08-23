import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PatientIntakePage from '../pages/PatientIntakePage.vue'
import { createAppRouter } from '../router'
import { agentService, workspaceService } from '../services'
import { usePatientIntakeStore } from '../stores'

const runtimeConfig = {
  default_provider: 'test-provider',
  default_model: 'test-model',
  feedback_enabled: false,
  models: [{
    provider: 'test-provider', provider_label: '测试服务', model: 'test-model',
    model_label: '测试模型', available: true,
  }],
}

const mountPatientPage = async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push('/patient/intake')
  await router.isReady()
  const wrapper = mount(PatientIntakePage, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(agentService, 'getRuntimeConfig').mockResolvedValue(runtimeConfig)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('患者健康问答页面', () => {
  it('显示服务器状态，并使用专家研究契约渲染健康回答和详细报告', async () => {
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
    const wrapper = await mountPatientPage()

    expect(wrapper.get('.patient-status-panel').text()).toContain('已连接')
    expect(wrapper.get('.patient-status-panel').text()).toContain('测试服务')
    expect(wrapper.get('.patient-status-panel').text()).toContain('测试模型')

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

  it('可从左侧导航打开患者报告库和问答记录，并返回原会话', async () => {
    vi.spyOn(workspaceService, 'read').mockResolvedValue({
      session_id: 'research-session-1',
      path: 'reports/final.md',
      kind: 'report',
      size: 42,
      modified_at: '2026-08-24T08:00:00.000Z',
      content: '## 健康结论\n\n这是从患者报告库读取的详细依据。',
    })
    const wrapper = await mountPatientPage()
    const intake = usePatientIntakeStore()
    intake.active.title = '头痛需要何时就医'
    intake.active.researchSessionId = 'research-session-1'
    intake.active.messages.push(
      { id: 'patient-question-1', role: 'user', content: '头痛需要何时就医？', createdAt: '2026-08-24T07:00:00.000Z' },
      {
        id: 'patient-answer-1', role: 'assistant', content: '先识别危险信号。',
        createdAt: '2026-08-24T08:00:00.000Z', reportPath: 'reports/final.md', researchMode: 'expert',
      },
    )
    await wrapper.vm.$nextTick()

    await wrapper.get('button[aria-label="患者报告库"]').trigger('click')
    expect(wrapper.get('.patient-section-page').text()).toContain('头痛需要何时就医')
    await wrapper.get('.asset-project').trigger('click')
    await flushPromises()
    expect(workspaceService.read).toHaveBeenCalledWith('research-session-1', 'reports/final.md')
    expect(wrapper.get('.asset-reader').text()).toContain('这是从患者报告库读取的详细依据。')

    await wrapper.get('button[aria-label="问答记录"]').trigger('click')
    expect(wrapper.get('.patient-section-page').text()).toContain('回到之前的健康问题')
    await wrapper.get('.asset-project').trigger('click')
    expect(wrapper.find('.patient-workspace').exists()).toBe(true)
    expect(wrapper.text()).toContain('头痛需要何时就医？')
  })
})
