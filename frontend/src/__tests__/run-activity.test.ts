import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RunActivity from '../components/evidence/RunActivity.vue'

describe('研究进展计时', () => {
  it('shows total runtime in the header and each progress segment own duration', () => {
    const wrapper = mount(RunActivity, {
      props: {
        trace: [],
        pending: false,
        startedAt: '2026-08-02T00:00:00.000Z',
        completedAt: '2026-08-02T00:00:50.000Z',
        progressUpdates: [
          { text: '定位指南推荐。', timestamp: '2026-08-02T00:00:10.000Z' },
          { text: '核对随机试验。', timestamp: '2026-08-02T00:00:35.000Z' },
        ],
      },
    })

    expect(wrapper.get('.research-progress-head small').text()).toBe('总计 50 秒')
    expect(wrapper.findAll('.research-progress-notes small').map((item) => item.text())).toEqual(['25 秒', '15 秒'])
  })
  it("keeps a completed patient answer process overview when no tool event was emitted", () => {
    const wrapper = mount(RunActivity, {
      props: {
        trace: [],
        pending: false,
        audience: "patient",
        startedAt: "2026-08-02T00:00:00.000Z",
        completedAt: "2026-08-02T00:00:03.000Z",
        progressUpdates: [],
        tools: [],
      },
    })

    expect(wrapper.attributes("aria-label")).toBe("健康问答过程概览")
    expect(wrapper.text()).toContain("本轮健康问答已完成")
    expect(wrapper.text()).toContain("已完成本轮健康问答。")
  })
})
