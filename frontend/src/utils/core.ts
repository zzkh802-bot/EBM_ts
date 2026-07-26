import type { AgentRequest, AttachmentData, ModeSnapshot, Session } from '../types/domain'

export const STORAGE_KEYS = {
  sessions: 'dp_xunyi_sessions_v1',
  activeSession: 'dp_xunyi_active_session_v1',
  knowledge: 'dp_xunyi_knowledge_items_v1',
  theme: 'dp_xunyi_theme_mode_v1',
  modes: 'xunyi_answer_modes_v1',
  legacySession: 'ebm_session_id',
} as const

export const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

export const nowIso = () => new Date().toISOString()

export function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

export function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // Storage may be disabled in privacy contexts.
  }
}

export function readLegacyString(key: string, fallback = '') {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') {
      safeWrite(key, parsed)
      return parsed
    }
  } catch {
    // Expected for the original raw-string storage format.
  }
  return raw
}

export function migrateSessions(value: unknown, legacyEbmSessionId = ''): Session[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && item.id && Array.isArray(item.messages)))
    .map((item, index) => ({
      ...item,
      id: String(item.id),
      title: String(item.title || '新的循证对话'),
      createdAt: String(item.createdAt || nowIso()),
      updatedAt: String(item.updatedAt || nowIso()),
      ebmSessionId: String(item.ebmSessionId || item.ebm_session_id || (index === 0 ? legacyEbmSessionId : '') || '') || null,
      v2SessionId: String(item.v2SessionId || item.v2_session_id || '') || null,
      messages: item.messages as Session['messages'],
    }))
}

export function modeIterationBudget(mode: ModeSnapshot): 5 | 12 {
  return mode.researchMode === 'instant' ? 5 : 12
}

export function modeTimeoutSeconds(mode: ModeSnapshot): 300 | 600 {
  return mode.researchMode === 'instant' ? 300 : 600
}

export function buildAgentRequest(
  question: string,
  backendQuestion: string,
  attachments: AttachmentData[],
  ebmSessionId: string,
  mode: ModeSnapshot,
): AgentRequest {
  return {
    question: backendQuestion,
    stable_question: question,
    stable_cache: true,
    attachments: attachments.map(({ name, size, type, dataUrl }) => ({
      name,
      size,
      type,
      content_base64: dataUrl,
    })),
    ebm_session_id: ebmSessionId,
    max_iterations: modeIterationBudget(mode),
    request_timeout_seconds: modeTimeoutSeconds(mode),
    research_mode: mode.researchMode,
    audience_mode: mode.audienceMode,
    deep_think: mode.deepThink,
    search_enabled: mode.searchEnabled,
  }
}

export const responseText = (data: { report_markdown?: string; agent_answer?: string; message?: string }) =>
  data.report_markdown || data.agent_answer || data.message || '本轮没有生成回答。'
