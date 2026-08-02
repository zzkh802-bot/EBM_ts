import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EvidencePage from '../pages/EvidencePage.vue'
import { createAppRouter } from '../router'
import { useSessionsStore } from '../stores'

afterEach(() => vi.unstubAllGlobals())

describe('医生工作台回答展示', () => {
  it('将正式报告前的模型回答按 Markdown 渲染', async () => {
    setActivePinia(createPinia())
    const sessions = useSessionsStore()
    sessions.active.messages = [{
      id: 'answer-1',
      role: 'assistant',
      title: '循证回答',
      content: '报告保存在：`reports/final.md`\n\n**核心结论摘要：** 可优先考虑该方案。',
      reportMarkdown: '## 正式报告\n\n完整报告正文。',
      reportPath: 'reports/final.md',
      createdAt: '2026-08-02T00:00:00.000Z',
      trace: [],
      audienceMode: 'clinician',
      thinkingLevel: 'medium',
      searchEnabled: true,
    }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    const router = createAppRouter(createMemoryHistory())
    await router.push('/clinician/evidence')
    await router.isReady()

    const wrapper = mount(EvidencePage, { global: { plugins: [router] } })
    const summary = wrapper.get('.model-answer')

    expect(summary.get('code').text()).toBe('reports/final.md')
    expect(summary.get('strong').text()).toBe('核心结论摘要：')
    expect(summary.text()).not.toContain('**')
  })
})
