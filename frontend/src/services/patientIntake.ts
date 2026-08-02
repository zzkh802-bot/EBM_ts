import type { PatientConversationMode, PatientIntakeResponse, PatientProfile } from '../types/domain'
import { postJson } from './http'

export type IntakeRequest = {
  message: string
  client_session_id: string
  mode: PatientConversationMode
  thinking_enabled: boolean
  profile?: Pick<PatientProfile, 'id' | 'name' | 'sex' | 'age' | 'allergies' | 'pregnancy' | 'memory'> & { revision: string }
}

export const patientIntakeService = {
  message: (body: IntakeRequest, signal?: AbortSignal) => postJson<PatientIntakeResponse>('/ts-api/api/v1/patient-intake/messages', body, signal, 125_000),
  summary: (body: IntakeRequest, signal?: AbortSignal) => postJson<PatientIntakeResponse>('/ts-api/api/v1/patient-intake/summary', body, signal, 125_000),
}
