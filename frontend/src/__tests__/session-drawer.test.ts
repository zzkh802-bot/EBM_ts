import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SessionDrawer from '../components/shell/SessionDrawer.vue'
import { createAppRouter } from '../router'
import { useAgentRunStore, useSessionsStore } from '../stores'

beforeEach(() => localStorage.clear())
afterEach(() => useAgentRunStore().finish())

describe('研究记录抽屉', () => {
  it('研究进行中禁止清空承载在途结果的会话', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clinician/evidence')
    await router.isReady()
    const sessions = useSessionsStore()
    const run = useAgentRunStore()
    const inFlightSessionId = sessions.activeSessionId
    sessions.beginResearchIn(inFlightSessionId, '正在运行的临床问题')
    run.start()

    const wrapper = mount(SessionDrawer, { global: { plugins: [pinia, router] } })
    const clear = wrapper.get<HTMLButtonElement>('.history-clear')
    expect(clear.element.disabled).toBe(true)
    await clear.trigger('click')
    expect(sessions.sessions.some((session) => session.id === inFlightSessionId)).toBe(true)
  })

  it('并行研究时保持侧栏顺序稳定，避免更新时间刷新导致列表跳动', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clinician/evidence')
    await router.isReady()
    const sessions = useSessionsStore()
    const run = useAgentRunStore()
    const first = sessions.activeSessionId
    sessions.beginResearchIn(first, '第一个并行问题')
    sessions.addMessageTo(first, { id: 'question-a', role: 'user', title: '问题', content: '第一个并行问题', createdAt: new Date().toISOString(), trace: [], audienceMode: 'clinician', thinkingLevel: 'low', searchEnabled: true })
    const second = sessions.create()
    sessions.beginResearchIn(second, '第二个并行问题')
    sessions.addMessageTo(second, { id: 'question-b', role: 'user', title: '问题', content: '第二个并行问题', createdAt: new Date().toISOString(), trace: [], audienceMode: 'clinician', thinkingLevel: 'low', searchEnabled: true })
    run.start(first)
    run.start(second)

    const wrapper = mount(SessionDrawer, { global: { plugins: [pinia, router] } })
    const initialOrder = wrapper.findAll('.history-question').map((item) => item.text())
    sessions.patchMessageIn(first, 'question-a', { content: '第一个问题刚刚收到新的运行进度' })
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.history-question').map((item) => item.text())).toEqual(initialOrder)
  })
})
