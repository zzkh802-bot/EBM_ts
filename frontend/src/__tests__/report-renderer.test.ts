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

  it('按语义层级渲染报告与始终可见的标准参考文献', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'clinician' } })
    expect(wrapper.find('.report-markdown').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toContain('结论摘要')
    expect(wrapper.text()).toContain('血压管理三要点')
    expect(wrapper.find('.reference-panel').text()).toContain('1 条')
    expect(wrapper.find('.reference-card').text()).toContain('PMID: 25106063')
    expect(wrapper.find('details.reference-panel').exists()).toBe(false)
  })

  it('展示后端自动追加的标准书目，而不是把它当作工作区文件', () => {
    const backendGenerated = `## 综合判断\n\n推荐治疗 [1]\n\n## 参考文献\n\n1. [1] Smith J, Wang L, et al. A randomized clinical trial. N Engl J Med. 2024;390:10-20. PMID: 12345678`
    const wrapper = mount(ReportRenderer, { props: { markdown: backendGenerated, audience: 'clinician' } })
    const bibliography = wrapper.find('.reference-card')
    expect(bibliography.text()).toContain('Smith J, Wang L, et al. A randomized clinical trial.')
    expect(bibliography.text()).not.toContain('[1] [1]')
  })

  it('保留疗效、安全结局与表格的语义内容', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'clinician' } })
    expect(wrapper.findAll('h3').map((node) => node.text())).toContain('主要疗效结局')
    expect(wrapper.findAll('h3').map((node) => node.text())).toContain('重大出血风险')
    expect(wrapper.find('.report-table-wrap table').text()).toContain('RR 1.25')
  })

  it('完整保留后端正式报告的多级标题，不强行折叠章节', () => {
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
    const wrapper = mount(ReportRenderer, { props: { markdown: actualV2Shape, audience: 'clinician' } })
    expect(wrapper.find('.report-markdown').text()).toContain('IgA 肾病持续性蛋白尿的治疗选择')
    expect(wrapper.findAll('h3').map((node) => node.text())).toEqual(expect.arrayContaining(['核心结论', '4. 感染风险对比', '5. 综合决策路径']))
    expect(wrapper.findAll('details.report-fold')).toHaveLength(0)
    expect(wrapper.find('.reference-panel').text()).toContain('1 条')
  })

  it('普通用户版略去过度专业的段落', () => {
    const wrapper = mount(ReportRenderer, { props: { markdown, audience: 'public' } })
    expect(wrapper.text()).toContain('患者当前可接受治疗')
    expect(wrapper.text()).toContain('血压管理三要点')
    expect(wrapper.text()).not.toContain('专业检索方法')
    expect(wrapper.text()).not.toContain('效应量、亚组分析')
  })
})
