import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReportRenderer from '../components/report/ReportRenderer.vue'

describe('报告清晰渲染', () => {
  const markdown = `## 结论摘要
患者当前可接受治疗 [1]

## PICO 与检索策略
专业检索方法和 GRADE 证据分级。

## 详细证据分析
循证分析前言。

### 主要疗效结局
效应量、亚组分析及统计学细节。

### 重大出血风险
重大出血没有显著增加。

| 结局 | 效应量 |
| --- | --- |
| 缓解 | RR 1.25 |

## 血压管理三要点
1. **治疗前**
   - 复测血压
   - 排除禁忌

## 核心参考文献
1. Guideline. PMID: 25106063`

  it('使用重点卡片、行动卡片和折叠参考文献', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'clinician' } })
    expect(wrapper.find('.report-markdown').exists()).toBe(true)
    expect(wrapper.find('.report-section-card.authority').text()).toContain('结论摘要')
    expect(wrapper.find('.report-section-card.action').text()).toContain('血压管理三要点')
    expect(wrapper.find('.reference-panel').text()).toContain('1 条')
    expect(wrapper.find('.reference-card').text()).toContain('PMID: 25106063')
  })

  it('Instant 与 Expert 使用相同的前端展示策略', () => {
    const instant = mount(ReportRenderer, { props: { markdown, audience: 'clinician', researchMode: 'instant' } })
    const expert = mount(ReportRenderer, { props: { markdown, audience: 'clinician', researchMode: 'expert' } })
    const instantSections = instant.findAll('details.report-fold')
    const expertSections = expert.findAll('details.report-fold')
    expect(instantSections).toHaveLength(expertSections.length)
    expect(instantSections.map((section) => section.attributes('open')))
      .toEqual(expertSections.map((section) => section.attributes('open')))
    expect(instantSections.every((section) => section.attributes('open') === undefined)).toBe(true)
  })

  it('把 H3 疗效与安全结局拆成独立区块并保留表格', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'clinician' } })
    expect(wrapper.find('.report-section-group').text()).toContain('详细证据分析')
    expect(wrapper.findAll('details.report-fold').some((section) => section.text().includes('主要疗效结局'))).toBe(true)
    expect(wrapper.find('.report-section-card.safety').text()).toContain('重大出血风险')
    expect(wrapper.find('.report-section-card.safety table').text()).toContain('RR 1.25')
  })

  it('普通用户版略去过度专业的段落', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'public', researchMode: 'instant' } })
    expect(wrapper.text()).toContain('患者当前可接受治疗')
    expect(wrapper.text()).toContain('血压管理三要点')
    expect(wrapper.text()).not.toContain('专业检索方法')
    expect(wrapper.text()).not.toContain('效应量、亚组分析')
  })
})
