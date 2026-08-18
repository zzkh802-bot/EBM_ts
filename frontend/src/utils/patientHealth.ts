import type { PatientHealthAnswer, PatientSafetyLevel } from '../types/domain'

const levels = new Set<PatientSafetyLevel>(['routine', 'clarification_needed', 'prompt_medical_review', 'urgent', 'emergency'])

export function normalizePatientHealthAnswer(value: unknown, fallbackText = ''): PatientHealthAnswer | undefined {
  const parsed = isRecord(value) ? value : parseJson(fallbackText)
  const answer = isRecord(parsed?.answer) ? parsed.answer : parsed
  const fallback = fallbackText.trim()
  const bottomLine = text(answer?.bottom_line) || text(answer?.bottomLine) || firstParagraph(fallback)
  if (!bottomLine) return undefined
  const actions = list(answer?.actions)
  const redFlags = list(answer?.red_flags)
  const followUpQuestions = list(answer?.follow_up_questions)
  const safetyObject = isRecord(answer?.safety) ? answer.safety : undefined
  const safetyLevel = levels.has(safetyObject?.level as PatientSafetyLevel)
    ? safetyObject?.level as PatientSafetyLevel
    : followUpQuestions.length && !actions.length ? 'clarification_needed' : 'routine'
  return {
    contract_version: text(answer?.contract_version) || 'xunyi-patient-health/v1',
    status: answer?.status === 'clarification_needed' ? 'clarification_needed' : 'answered',
    bottom_line: bottomLine,
    actions,
    red_flags: redFlags,
    when_to_seek_care: text(answer?.when_to_seek_care) || '如果症状持续、加重或影响日常生活，建议尽快咨询医生；出现明显危险信号时立即就医。',
    follow_up_questions: followUpQuestions,
    uncertainty: text(answer?.uncertainty) || '仅凭当前描述不能确定具体原因，是否需要检查取决于症状、持续时间和个人情况。',
    safety: {
      level: safetyLevel,
      needs_urgent_care: safetyObject?.needs_urgent_care === true,
    },
  }
}

function parseJson(value: string): Record<string, unknown> | undefined {
  const trimmed = value.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const candidates = [trimmed, start >= 0 && end > start ? trimmed.slice(start, end + 1) : '']
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      // An older server may return natural-language text; use it below.
    }
  }
  return undefined
}

function firstParagraph(value: string): string {
  return value.split(/\n\s*\n/).map((part) => part.replace(/^#{1,6}\s+/, '').trim()).find(Boolean) || ''
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 6)
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
