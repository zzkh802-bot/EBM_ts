import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RightDetailPanel from '../components/shell/RightDetailPanel.vue'
import { useUiStore } from '../stores'

afterEach(() => vi.unstubAllGlobals())

describe('报告引用核验', () => {
  it('展示已核验的原文片段与公开原文链接，不展示内部 evidence ID', async () => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const payload = {
        number: 1,
        citation: 'Randomized trial. PMID 12345678.',
        evidence: [{
          claim: '该治疗降低复发。',
          quote: '## Results\n\n**The intervention** reduced recurrence without increasing severe bleeding.',
          relation: 'supports',
          provenance: 'primary_abstract',
          confidence: 'high',
          verified: true,
          source: {
            title: 'Randomized trial',
            url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
          },
        }],
      }
      return Promise.resolve(new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }))
    }))
    const ui = useUiStore()
    ui.openDetail('引用 [1]', {
      number: '1', content: 'Randomized trial.', title: 'Randomized trial.', pmid: '12345678',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', sessionId: 'session-1', reportPath: 'reports/final.md',
    }, 'citation')

    const wrapper = mount(RightDetailPanel)
    await flushPromises()

    expect(wrapper.find('.citation-backdrop').exists()).toBe(false)
    expect(wrapper.get('.citation-evidence-quote h2').text()).toBe('Results')
    expect(wrapper.get('.citation-evidence-quote strong').text()).toBe('The intervention')
    expect(wrapper.get('.citation-evidence-source a').attributes('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/12345678/')
    expect(wrapper.find('.citation-source-archive-button').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/ev_[a-f0-9]{16}/)
  })

  it('MCP 来源只展示名称和机构，不提供内部全文阅读按钮', async () => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      number: 2,
      citation: '中国指南（2023 年版）.',
      evidence: [{
        claim: '指南推荐该治疗。', quote: '指南建议在符合条件时使用该治疗。', relation: 'supports',
        provenance: 'guideline_official', confidence: 'high', verified: true,
        source: {
          title: '中国指南（2023 年版）', institution: '中华医学会', url: '',
        },
      }],
    }), { headers: { 'Content-Type': 'application/json' } })))
    const ui = useUiStore()
    ui.openDetail('引用 [2]', {
      number: '2', content: '中国指南（2023 年版）.', title: '中国指南（2023 年版）.', pmid: '', url: '',
      sessionId: 'session-1', reportPath: 'reports/final.md',
    }, 'citation')

    const wrapper = mount(RightDetailPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('中华医学会')
    expect(wrapper.find('.citation-source-archive-button').exists()).toBe(false)
  })
})
