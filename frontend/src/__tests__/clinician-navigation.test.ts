import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionDrawer from '../components/shell/SessionDrawer.vue'
import EntryPage from '../pages/EntryPage.vue'
import EvidencePage from '../pages/EvidencePage.vue'
import { createAppRouter } from '../router'
import { useSessionsStore } from '../stores'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => vi.unstubAllGlobals())

const routerFor = () => createAppRouter(createMemoryHistory())

describe('医生工作台入口与新建问题', () => {
  it('从主入口进入医生首页，而不是上一次对话', async () => {
    const router = routerFor()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(EntryPage, { global: { plugins: [router] } })

    await wrapper.get('.entry-choice.clinician').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/clinician')
  })

  it('默认开放患者端健康问答入口', async () => {
    const router = routerFor()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(EntryPage, { global: { plugins: [router] } })

    const patientEntry = wrapper.get<HTMLButtonElement>('.entry-choice.patient')
    expect(patientEntry.element.disabled).toBe(false)
    expect(patientEntry.text()).toContain('健康问答')
    expect(patientEntry.text()).not.toContain('我是患者')
    expect(patientEntry.text()).toContain('开始提问')

    await router.push('/patient/intake')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/patient/intake')
  })

  it('点击新建临床问题只回到首页，不提前创建研究记录', async () => {
    const router = routerFor()
    await router.push('/clinician/evidence')
    await router.isReady()
    const sessions = useSessionsStore()
    const wrapper = mount(SessionDrawer, { global: { plugins: [router] } })

    await wrapper.get('.drawer-new-question').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/clinician')
    expect(sessions.sessions).toHaveLength(1)
    expect(wrapper.findAll('.history-item')).toHaveLength(0)
  })

  it('医生首页不受上一次活动会话影响，并在首次发送时才创建新记录', async () => {
    const sessions = useSessionsStore()
    sessions.active.messages.push({
      id: 'question-1', role: 'user', title: '临床问题', content: '既往问题',
      createdAt: '2026-08-02T00:00:00.000Z', trace: [], audienceMode: 'clinician',
      thinkingLevel: 'medium', searchEnabled: true,
    })
    sessions.beginResearchIn(sessions.activeSessionId, '既往问题')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    const router = routerFor()
    await router.push('/clinician')
    await router.isReady()

    const wrapper = mount(EvidencePage, { global: { plugins: [router] } })

    expect(wrapper.find('.hero-dp').exists()).toBe(true)
    expect(wrapper.find('.conversation-context').exists()).toBe(false)
    expect(wrapper.find('.chat-message').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('既往问题')
    expect(sessions.sessions).toHaveLength(1)

    await wrapper.get('textarea[aria-label="医学问题"]').setValue('新的临床问题')
    await wrapper.get('.send-button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/clinician/evidence')
    expect(sessions.sessions).toHaveLength(2)
    expect(sessions.active.clinicalQuestion).toBe('新的临床问题')
    expect(wrapper.find('.chat-message').exists()).toBe(true)
    expect(wrapper.text()).toContain('新的临床问题')
  })
})
