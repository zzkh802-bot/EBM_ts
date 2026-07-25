import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReportRenderer from '../components/report/ReportRenderer.vue'

describe('报告清晰渲染', () => {
  const markdown = `## 结论摘要
患者当前可接受治疗 [1]

## PICO 与检索策略
专业检索方法和 GRADE 证据分级。

## 详细证据分析
效应量、亚组分析及统计学细节。

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

  it('Instant 保留完整报告但默认折叠专业细节', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'clinician', researchMode: 'instant' } })
    const detailSections = wrapper.findAll('details.report-fold')
    expect(wrapper.text()).toContain('专业检索方法')
    expect(detailSections.length).toBeGreaterThan(0)
    expect(detailSections.some((section) => !section.attributes('open'))).toBe(true)
  })

  it('Expert 默认展开完整专业细节', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'clinician', researchMode: 'expert' } })
    const detailSections = wrapper.findAll('details.report-fold')
    expect(wrapper.text()).toContain('效应量、亚组分析')
    expect(detailSections.every((section) => section.attributes('open') !== undefined)).toBe(true)
  })

  it('普通用户版略去过度专业的段落', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'public', researchMode: 'instant' } })
    expect(wrapper.text()).toContain('患者当前可接受治疗')
    expect(wrapper.text()).toContain('血压管理三要点')
    expect(wrapper.text()).not.toContain('专业检索方法')
    expect(wrapper.text()).not.toContain('效应量、亚组分析')
  })
})
