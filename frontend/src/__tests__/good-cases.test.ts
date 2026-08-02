import { describe, expect, it } from 'vitest'
import { goodCases } from '../data/goodCases'

describe('循证 Good Cases', () => {
  it('展示 9 个经过筛选的跨科室案例', () => {
    expect(goodCases).toHaveLength(9)
    expect(new Set(goodCases.map((item) => item.id)).size).toBe(9)
    expect(new Set(goodCases.map((item) => item.department)).size).toBe(9)
    expect(goodCases.map((item) => item.id)).toContain('ENV13-CARD-001')
    expect(goodCases.map((item) => item.id)).toContain('MCP-D26-C05')
  })

  it('每个案例都提供可直接用于研究会话的完整问题', () => {
    expect(goodCases.every((item) => item.question.trim().length > 20)).toBe(true)
    expect(goodCases.find((item) => item.id === 'MCP-D07-C05')?.question).toContain('危机干预')
  })
})
