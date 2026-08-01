import type { PatientIntakeResponse } from '../types/domain'
import { postJson } from './http'

type IntakeRequest = { message: string; session_id?: string }

export const patientIntakeService = {
  message: (body: IntakeRequest, signal?: AbortSignal) => postJson<PatientIntakeResponse>('/ts-api/api/v1/patient-intake/messages', body, signal, 125_000),
  summary: (body: IntakeRequest, signal?: AbortSignal) => postJson<PatientIntakeResponse>('/ts-api/api/v1/patient-intake/summary', body, signal, 125_000),
}
