import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PatientAppHeader from '../components/patient/PatientAppHeader.vue'
import PatientDesktopRail from '../components/patient/PatientDesktopRail.vue'
import PatientSessionDrawer from '../components/patient/PatientSessionDrawer.vue'
import PatientIntakePage from '../pages/PatientIntakePage.vue'
import PatientKnowledgePage from '../pages/PatientKnowledgePage.vue'
import { createAppRouter } from '../router'
import { agentService, healthService, workspaceService } from '../services'
import { useAgentRunStore, usePatientIntakeStore, useUiStore } from '../stores'
import type { AgentRunResponse } from '../types/domain'

const runtimeConfig = {
  default_provider: 'test-provider',
  default_model: 'test-model',
  feedback_enabled: false,
  models: [{
    provider: 'test-provider', provider_label: '测试服务', model: 'test-model',
    model_label: '测试模型', available: true,
  }],
}

const setupRouter = async (path: string) => {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  return router
}

const mountPatientPage = async (path = '/patient/intake') => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = await setupRouter(path)
  const wrapper = mount(PatientIntakePage, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, pinia, router }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(healthService, 'check').mockResolvedValue({ ok: true })
  vi.spyOn(agentService, 'getRuntimeConfig').mockResolvedValue(runtimeConfig)
  vi.spyOn(workspaceService, 'list').mockResolvedValue({ session_id: 'empty', files: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('患者健康问答真实接口与工作区', () => {
  it('分别检查健康接口和运行配置，并以患者契约提交专家问答', async () => {
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
    const { wrapper } = await mountPatientPage()

    expect(healthService.check).toHaveBeenCalled()
    expect(wrapper.get('.patient-status-panel').text()).toContain('服务在线')
    expect(wrapper.get('.patient-status-panel').text()).toContain('/ts-api/health 可达')
    expect(wrapper.get('.patient-status-panel').text()).toContain('运行配置已读取')
    expect(wrapper.get('.patient-status-panel').text()).toContain('测试服务')
    expect(wrapper.get('.patient-status-panel').text()).toContain('测试模型')

    await wrapper.findAll('.patient-mode-switch button')[1]!.trigger('click')
    await wrapper.get('textarea[aria-label="健康问题"]').setValue('最近总是头痛，哪些情况需要尽快就医？')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      audience_mode: 'patient', research_mode: 'expert', thinking_level: 'high',
      response_mode: 'auto', search_enabled: true,
    }), expect.any(AbortSignal), expect.any(Object))
    expect(wrapper.text()).toContain('当前可以先观察，但出现危险信号时应及时就医。')
    expect(wrapper.text()).toContain('这是可核对的报告正文。')
    expect(wrapper.get('.message-mode').text()).toBe('专家模式')
  })

  it('从患者会话的服务端工作区列出、读取报告并携带上下文核验引用', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const intake = usePatientIntakeStore()
    intake.active.title = '头痛需要何时就医'
    intake.active.researchSessionId = 'research-session-1'
    intake.add({ id: 'question-1', role: 'user', content: '头痛需要何时就医？', createdAt: '2026-08-24T07:00:00.000Z' })
    vi.mocked(workspaceService.list).mockResolvedValue({
      session_id: 'research-session-1',
      files: [{ path: 'reports/final.md', kind: 'report', size: 42, modified_at: '2026-08-24T08:00:00.000Z' }],
    })
    const read = vi.spyOn(workspaceService, 'read').mockResolvedValue({
      session_id: 'research-session-1',
      path: 'reports/final.md',
      kind: 'report',
      size: 42,
      modified_at: '2026-08-24T08:00:00.000Z',
      content: '## 健康结论\n\n这是服务端报告支持的结论 [1]。\n\n## 参考文献\n\n1. [1] Randomized trial. PMID: 12345678',
    })
    const router = await setupRouter('/patient/reports')
    const wrapper = mount(PatientKnowledgePage, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(workspaceService.list).toHaveBeenCalledWith('research-session-1')
    expect(wrapper.get('.asset-project').text()).toContain('头痛需要何时就医')
    await wrapper.get('.asset-project').trigger('click')
    await flushPromises()
    expect(read).toHaveBeenCalledWith('research-session-1', 'reports/final.md')
    expect(wrapper.get('.asset-reader').text()).toContain('这是服务端报告支持的结论')

    await wrapper.get('.asset-reader .citation-pill').trigger('click')
    expect(useUiStore().detailPayload).toMatchObject({
      number: '1', sessionId: 'research-session-1', reportPath: 'reports/final.md',
    })
  })

  it('顶部状态来自健康接口，侧栏导航使用患者独立路由', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = await setupRouter('/patient')
    const header = mount(PatientAppHeader, { global: { plugins: [pinia, router] } })
    const rail = mount(PatientDesktopRail, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(header.get('.service-status').text()).toContain('在线')
    await rail.get('button[aria-label="患者报告库"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/patient/reports')

    header.unmount()
    vi.mocked(healthService.check).mockRejectedValueOnce(new Error('offline'))
    const offlineHeader = mount(PatientAppHeader, { global: { plugins: [pinia, router] } })
    await flushPromises()
    expect(offlineHeader.get('.service-status').text()).toContain('离线')
  })

  it('问答抽屉打开已有患者会话，不混入医生端记录', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const intake = usePatientIntakeStore()
    const firstId = intake.activeSessionId
    intake.add({ id: 'patient-question-1', role: 'user', content: '流鼻血应该怎么办？', createdAt: '2026-08-24T07:00:00.000Z' })
    const second = intake.create()
    intake.add({ id: 'patient-question-2', role: 'user', content: '皮肤红疹需要就医吗？', createdAt: '2026-08-24T08:00:00.000Z' })
    expect(intake.activeSessionId).toBe(second.id)
    const router = await setupRouter('/patient')
    const ui = useUiStore()
    ui.sessionDrawerOpen = true
    const wrapper = mount(PatientSessionDrawer, { global: { plugins: [pinia, router] } })

    const first = wrapper.findAll('.history-item').find((item) => item.text().includes('流鼻血应该怎么办'))
    expect(first).toBeDefined()
    await first!.trigger('click')
    await flushPromises()

    expect(intake.activeSessionId).toBe(firstId)
    expect(router.currentRoute.value.path).toBe('/patient/intake')
    expect(ui.sessionDrawerOpen).toBe(false)
  })

  it('同一会话运行时把新输入加入后续追问队列', async () => {
    let finishRun!: (value: AgentRunResponse) => void
    const runRequest = vi.spyOn(agentService, 'run').mockImplementation(() => new Promise<AgentRunResponse>((resolve) => {
      finishRun = resolve
    }))
    const { wrapper } = await mountPatientPage()

    await wrapper.get('textarea[aria-label="健康问题"]').setValue('头痛时先观察什么？')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()
    expect(useAgentRunStore().busy).toBe(true)

    await wrapper.get('textarea[aria-label="健康问题"]').setValue('如果同时发热呢？')
    await wrapper.get('.send-button').trigger('click')
    expect(runRequest).toHaveBeenCalledTimes(1)
    expect(useAgentRunStore().queuedGuidance).toEqual(['如果同时发热呢？'])
    expect(wrapper.get('.queue-tray').text()).toContain('如果同时发热呢？')

    finishRun({
      contract_version: 'xunyi-research/v1', run_id: 'queued-run-1', status: 'succeeded',
      agent_answer: '先记录症状变化。',
    })
    await flushPromises()
    expect(useAgentRunStore().busy).toBe(false)
  })
})
