import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildAgentRequest,
  migrateSessions,
  modeIterationBudget,
  modeTimeoutSeconds,
  readLegacyString,
  responseText,
} from '../utils/core'
import { extractReferences, parseReport, projectReport, reportPlainText } from '../utils/report'
import { usePreferencesStore, useSessionsStore } from '../stores'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('回答模式预算', () => {
  it.each([
    ['instant', false, 5, 150],
    ['instant', true, 8, 150],
    ['expert', false, 10, 300],
    ['expert', true, 14, 300],
  ] as const)('%s deep=%s', (researchMode, deepThink, budget, timeout) => {
    const mode = { researchMode, deepThink, audienceMode: 'clinician' as const, searchEnabled: true }
    expect(modeIterationBudget(mode)).toBe(budget)
    expect(modeTimeoutSeconds(mode)).toBe(timeout)
  })
})

describe('会话存储迁移', () => {
  it('兼容 snake_case 和旧 ebm_session_id', () => {
    const rows = migrateSessions([
      { id: 'a', title: 'A', messages: [], ebm_session_id: 'snake' },
      { id: 'b', title: 'B', messages: [] },
    ], 'legacy')
    expect(rows[0].ebmSessionId).toBe('snake')
    expect(rows[1].ebmSessionId).toBeNull()
    expect(migrateSessions([{ id: 'a', messages: [] }], 'legacy')[0].ebmSessionId).toBe('legacy')
  })
  it('兼容原始字符串和历史 JSON 字符串键值', () => {
    localStorage.setItem('dp_xunyi_theme_mode_v1', '"dark"')
    localStorage.setItem('dp_xunyi_sessions_v1', JSON.stringify([{ id: 'session-id', messages: [] }]))
    localStorage.setItem('dp_xunyi_active_session_v1', '"session-id"')
    expect(readLegacyString('dp_xunyi_theme_mode_v1')).toBe('dark')
    expect(localStorage.getItem('dp_xunyi_theme_mode_v1')).toBe('dark')
    expect(usePreferencesStore().themeMode).toBe('dark')
    expect(usePreferencesStore().backendVersion).toBe('v2')
    expect(useSessionsStore().activeSessionId).toBe('session-id')
    expect(localStorage.getItem('dp_xunyi_active_session_v1')).toBe('session-id')
  })
  it('为旧会话补齐独立的 V2 session', () => {
    const [session] = migrateSessions([{ id: 'a', messages: [], v2_session_id: 'pi-1' }])
    expect(session.v2SessionId).toBe('pi-1')
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

describe('Agent DTO', () => {
  it('保持四模式参数、双会话和响应优先级', () => {
    const dto = buildAgentRequest('稳定问题', '完整问题', [{
      id: 'ui-only', name: 'report.pdf', size: 42, type: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,QUJD',
    }], 'remote-1', {
      researchMode: 'expert', audienceMode: 'public', deepThink: true, searchEnabled: false,
    })
    expect(dto).toMatchObject({
      stable_question: '稳定问题', question: '完整问题', ebm_session_id: 'remote-1',
      max_iterations: 14, request_timeout_seconds: 300, research_mode: 'expert',
      audience_mode: 'public', deep_think: true, search_enabled: false,
    })
    expect(dto.attachments).toEqual([{
      name: 'report.pdf', size: 42, type: 'application/pdf',
      content_base64: 'data:application/pdf;base64,QUJD',
    }])
    expect(dto.attachments[0]).not.toHaveProperty('id')
    expect(dto.attachments[0]).not.toHaveProperty('dataUrl')
    expect(responseText({ report_markdown: 'report', agent_answer: 'answer', message: 'message' })).toBe('report')
    expect(responseText({ agent_answer: 'answer', message: 'message' })).toBe('answer')
  })
})
