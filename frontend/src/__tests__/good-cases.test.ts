import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GoodCaseGrid from '../components/evidence/GoodCaseGrid.vue'
import { goodCases } from '../data/goodCases'

describe('循证 Good Cases', () => {
  it('展示 9 个经过筛选的跨科室案例', () => {
    expect(goodCases).toHaveLength(9)
    expect(new Set(goodCases.map((item) => item.id)).size).toBe(9)
    expect(new Set(goodCases.map((item) => item.department)).size).toBe(9)
    expect(goodCases.map((item) => item.id)).toContain('ENV13-CARD-001')
    expect(goodCases.map((item) => item.id)).toContain('MCP-D26-C05')
  })

  it('点击卡片会发出对应完整问题', async () => {
    const wrapper = mount(GoodCaseGrid)
    const card = wrapper.get('[data-case-id="MCP-D07-C05"]')
    await card.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([
      goodCases.find((item) => item.id === 'MCP-D07-C05')?.question,
    ])
  })
})
