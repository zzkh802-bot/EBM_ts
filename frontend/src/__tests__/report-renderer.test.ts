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

  it('不会把线上 IgA 摘要错误压成单张折叠卡', () => {
    const actualV2Shape = `现在已有足够的证据来源，可以直接给出综合回答。

---

## IgA 肾病持续性蛋白尿的治疗选择：支持治疗 vs 免疫治疗 vs 单纯观察

### 核心结论
支持治疗是所有患者的治疗基石。

### 1. 风险分层：何时需要治疗？
蛋白尿持续时需要评估进展风险。

### 2. 支持治疗（Supportive Care）
支持治疗正文。

#### 2.1 RAAS 阻断剂（ACEi/ARB）
亚节正文。

### 3. 免疫抑制治疗
免疫抑制正文。

### 4. 感染风险对比
严重感染风险需要独立说明。

### 5. 综合决策路径
根据风险分层选择治疗。

### 6. 证据局限性
仍有证据缺口。

## 参考文献

1. Guideline. PMID: 35579642`
    const wrapper = mount(ReportRenderer, { props: { markdown: actualV2Shape, audience: 'clinician', researchMode: 'instant' } })
    expect(wrapper.find('.report-section-group').text()).toContain('IgA 肾病持续性蛋白尿的治疗选择')
    expect(wrapper.find('.report-section-card.authority').text()).toContain('核心结论')
    expect(wrapper.findAll('.report-section-card.safety').some((section) => section.text().includes('感染风险对比'))).toBe(true)
    expect(wrapper.find('.report-section-card.action').text()).toContain('综合决策路径')
    expect(wrapper.findAll('details.report-fold').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.find('.reference-panel').text()).toContain('1 条')
  })

  it('普通用户版略去过度专业的段落', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'public', researchMode: 'instant' } })
    expect(wrapper.text()).toContain('患者当前可接受治疗')
    expect(wrapper.text()).toContain('血压管理三要点')
    expect(wrapper.text()).not.toContain('专业检索方法')
    expect(wrapper.text()).not.toContain('效应量、亚组分析')
  })
})
