import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildResearchRunRequest,
  responseText,
} from '../utils/core'
import { extractReferences, parseReport, projectReport, reportPlainText } from '../utils/report'
import { usePreferencesStore, useSessionsStore } from '../stores'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('本地工作台状态', () => {
  it('不再读取已退役的历史会话和偏好键', () => {
    localStorage.setItem('dp_xunyi_theme_mode_v1', '"dark"')
    localStorage.setItem('dp_xunyi_sessions_v1', JSON.stringify([{ id: 'retired-session', messages: [] }]))
    localStorage.setItem('dp_xunyi_active_session_v1', '"retired-session"')
    expect(usePreferencesStore().themeMode).toBe('system')
    expect(useSessionsStore().activeSessionId).not.toBe('retired-session')
  })
})

describe('报告 AST 与投影', () => {
  const markdown = '# 结论\n建议治疗 [1]\n\n## PICO\nP: 成人\n\n## 风险提示\n注意出血。\n\n[1] Trial. PMID: 12345678 https://example.com'
  it('解析引用并隐藏公众版专业章节', () => {
    const refs = extractReferences(markdown)
    expect(refs['1'].pmid).toBe('12345678')
    const publicText = reportPlainText(projectReport(parseReport(markdown), 'public'))
    expect(publicText).toContain('建议治疗 [1]')
    expect(publicText).not.toContain('P: 成人')
    expect(publicText).toContain('注意出血')
    expect(reportPlainText(parseReport(markdown))).not.toContain('Trial. PMID')
  })

  it('保留嵌套管理要点并识别核心参考文献的有序编号', () => {
    const clinicalReport = `## 结论摘要
推荐治疗 [1]

## 血压管理三要点
1. **溶栓前**
   - 目标低于 180/105 mmHg
   - 当前无需额外降压 [1]
2. **溶栓后**
   - 每 15 分钟监测

## 核心参考文献
1. Emberson J, et al. Lancet. 2014. PMID: 25106063
2. 中国卒中学会指南. 2024.`
    const refs = extractReferences(clinicalReport)
    expect(Object.keys(refs)).toEqual(['1', '2'])
    expect(refs['1'].url).toBe('https://pubmed.ncbi.nlm.nih.gov/25106063/')
    const text = reportPlainText(parseReport(clinicalReport))
    expect(text).toContain('溶栓前\n• 目标低于 180/105 mmHg\n• 当前无需额外降压 [1]')
    expect(text).not.toContain('Emberson J')
  })
})

describe('Agent run DTO', () => {
  it('只构建当前后端契约需要的追踪会话请求', () => {
    const dto = buildResearchRunRequest('完整问题', 'remote-1', {
      thinkingLevel: 'max', audienceMode: 'public', searchEnabled: false,
    }, 'openai', 'gpt-5-mini')
    expect(dto).toMatchObject({
      question: '完整问题', session_id: 'remote-1',
      audience_mode: 'public', thinking_level: 'max', search_enabled: true,
      provider: 'openai', model: 'gpt-5-mini',
    })
    expect(dto).not.toHaveProperty('retrieval_policy')
    expect(responseText({ report_markdown: 'report', agent_answer: 'answer', message: 'message' })).toBe('answer')
    expect(responseText({ agent_answer: 'answer', message: 'message' })).toBe('answer')
  })
})
