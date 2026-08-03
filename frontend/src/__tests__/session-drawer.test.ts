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
})
