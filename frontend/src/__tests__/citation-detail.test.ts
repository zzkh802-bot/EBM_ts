import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RightDetailPanel from '../components/shell/RightDetailPanel.vue'
import { useUiStore } from '../stores'

afterEach(() => vi.unstubAllGlobals())

describe('报告引用核验', () => {
  it('展示已核验的原文片段与公开原文链接，不展示内部 evidence ID', async () => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      number: 1,
      citation: 'Randomized trial. PMID 12345678.',
      evidence: [{
        claim: '该治疗降低复发。',
        quote: 'The intervention reduced recurrence without increasing severe bleeding.',
        relation: 'supports',
        provenance: 'primary_abstract',
        confidence: 'high',
        verified: true,
        source: { title: 'Randomized trial', url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/' },
      }],
    }), { headers: { 'Content-Type': 'application/json' } })))
    const ui = useUiStore()
    ui.openDetail('引用 [1]', {
      number: '1', content: 'Randomized trial.', title: 'Randomized trial.', pmid: '12345678',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/', sessionId: 'session-1', reportPath: 'reports/final.md',
    }, 'citation')

    const wrapper = mount(RightDetailPanel)
    await flushPromises()

    expect(wrapper.get('.citation-evidence-quote').text()).toContain('The intervention reduced recurrence')
    expect(wrapper.get('.citation-evidence-source a').attributes('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/12345678/')
    expect(wrapper.text()).not.toMatch(/ev_[a-f0-9]{16}/)
  })
})
