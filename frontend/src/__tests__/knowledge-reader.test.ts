import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import KnowledgePage from '../pages/KnowledgePage.vue'
import { useKnowledgeStore } from '../stores/knowledge'
import { useUiStore } from '../stores'

afterEach(() => vi.unstubAllGlobals())

describe('研究报告库阅读', () => {
  it('在当前页面直接渲染所选报告，不再打开工作区抽屉', async () => {
    setActivePinia(createPinia())
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/knowledge', component: KnowledgePage }] })
    await router.push('/knowledge')
    await router.isReady()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: '## 最终报告\n\n这是直接阅读的正式报告 [1]。\n\n## 参考文献\n\n1. [1] Randomized trial. PMID: 12345678',
    }), { headers: { 'Content-Type': 'application/json' } })))
    const wrapper = mount(KnowledgePage, { global: { plugins: [router] } })
    await flushPromises()
    useKnowledgeStore().workspaceAssets = [{
      id: 'local-1:reports/final.md', sessionId: 'session-1', sessionTitle: '高危急性髓系白血病', sessionUpdatedAt: '2026-08-01T00:00:00.000Z',
      path: 'reports/final.md', kind: 'report', size: 1, modified_at: '2026-08-01T00:00:00.000Z',
    }]
    await wrapper.vm.$nextTick()

    await wrapper.find('.asset-project').trigger('click')
    await flushPromises()

    expect(wrapper.find('.asset-reader').exists()).toBe(true)
    expect(wrapper.find('.asset-reader .report-markdown').text()).toContain('这是直接阅读的正式报告')

    await wrapper.get('.asset-reader .citation-pill').trigger('click')
    expect(useUiStore().detailPayload).toMatchObject({
      number: '1', sessionId: 'session-1', reportPath: 'reports/final.md',
    })
  })
})
