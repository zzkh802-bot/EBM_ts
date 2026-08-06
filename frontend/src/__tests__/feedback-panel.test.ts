import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FeedbackPanel from '../components/evidence/FeedbackPanel.vue'

afterEach(() => vi.unstubAllGlobals())

describe('循证报告反馈问卷', () => {
  it('未显示工具偏好题时也能提交评分', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, session_id: 'session-1', path: 'feedback/feedback.jsonl' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(FeedbackPanel, { props: { sessionId: 'session-1', runId: 'run-1' } })

    for (const scale of wrapper.findAll('.feedback-scale')) await scale.find('button:last-child').trigger('click')
    const submit = wrapper.get('.feedback-submit')
    expect(submit.attributes('disabled')).toBeUndefined()
    await submit.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ run_id: 'run-1', query_id: 'run-1' })
    expect(wrapper.text()).toContain('已记录，谢谢')
  })
})
