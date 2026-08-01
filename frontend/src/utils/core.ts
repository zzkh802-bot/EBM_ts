import type { AgentRunRequest, ModeSnapshot, Session } from '../types/domain'

export const STORAGE_KEYS = {
  sessions: 'dp_xunyi_sessions',
  activeSession: 'dp_xunyi_active_session',
  theme: 'dp_xunyi_theme_mode',
  modes: 'dp_xunyi_preferences',
  runtime: 'dp_xunyi_runtime_model',
  patientIntake: 'dp_xunyi_patient_intake',
  patientIntakeActive: 'dp_xunyi_patient_intake_active',
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
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be disabled in privacy contexts.
  }
}

export function buildResearchRunRequest(
  question: string,
  sessionId: string | null,
  mode: ModeSnapshot,
  provider?: string,
  model?: string,
): AgentRunRequest {
  return {
    question,
    ...(sessionId ? { session_id: sessionId } : {}),
    audience_mode: mode.audienceMode,
    thinking_level: mode.thinkingLevel,
    search_enabled: mode.searchEnabled,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  }
}

export const responseText = (data: { report_markdown?: string; agent_answer?: string; message?: string }) =>
  data.agent_answer || data.message || data.report_markdown || '本轮没有生成回答。'
