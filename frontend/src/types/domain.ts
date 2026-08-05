export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'
export type AudienceMode = 'clinician' | 'public'
export type ThemeMode = 'light' | 'dark' | 'system'
export type ResearchSessionStatus = 'draft' | 'active' | 'complete'

export interface ModeSnapshot {
  audienceMode: AudienceMode
  thinkingLevel: ThinkingLevel
  searchEnabled: boolean
}

export interface TraceItem {
  kind?: string
  phase?: string
  label?: string
  summary?: string
  detail?: string
  tool?: string
  payload?: unknown
  arguments?: Record<string, unknown>
  timestamp?: string
}

export interface ResearchProgressUpdate {
  text: string
  timestamp: string
}

export type AgentRunStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
export type AgentStage = 'idle' | 'planning' | 'retrieving' | 'tooling' | 'generating' | 'network_wait'
export type ResponseMode = 'auto' | 'report' | 'answer'

export interface AgentRunRequest {
  question: string
  session_id?: string
  audience_mode: AudienceMode
  thinking_level: ThinkingLevel
  search_enabled: boolean
  response_mode?: ResponseMode
  provider?: string
  model?: string
  attachments?: string[]
}

export interface AttachmentUploadResponse {
  attachment_id: string
  file_name: string
  media_type: string
  size: number
}

export interface RuntimeModel {
  provider: string
  provider_label: string
  model: string
  model_label: string
  available: boolean
  setup_hint?: string
  connection_provider?: string
}

export interface AccountConnection {
  id: string
  provider: 'openai-codex' | 'anthropic'
  status: 'waiting' | 'connected' | 'failed' | 'cancelled'
  message: string
  authorization?: { url?: string; instructions?: string; device_code?: string; verification_url?: string }
  prompt?: {
    type: 'text' | 'select' | 'manual_code'
    message: string
    placeholder?: string
    options?: Array<{ id: string; label: string; description?: string }>
  }
}

export interface RuntimeConfig {
  default_provider: string
  default_model: string
  models: RuntimeModel[]
  feedback_enabled?: boolean
}

export interface InternalUser {
  id: string
  username: string
}

export interface InternalAuthConfig {
  auth_required: boolean
}

export type FeedbackRubric =
  | 'requirement_understanding'
  | 'clinical_interpretation_accuracy'
  | 'subquestion_decomposition'
  | 'evidence_support'
  | 'report_trustworthiness'
  | 'report_completeness'
  | 'report_clarity'
  | 'ebm_standard_compliance'
  | 'time_worth'
export type FeedbackRubrics = Partial<Record<FeedbackRubric, number>>
export type FeedbackPreferredTool = 'xunyi' | 'doubao' | 'no_preference' | 'not_used'

export interface AgentRunResponse {
  contract_version: string
  run_id: string
  query_id?: string
  status: AgentRunStatus
  stage?: AgentStage
  created_at?: string
  started_at?: string
  completed_at?: string
  session_id?: string
  message?: string
  agent_answer?: string
  report_markdown?: string
  report_path?: string
  patient_summary?: string
  agent_trace?: TraceItem[]
  progress_updates?: ResearchProgressUpdate[]
  tools?: Array<Record<string, unknown>>
  summary?: Record<string, unknown>
  error?: { code: string; message: string }
}

export interface Message extends ModeSnapshot {
  id: string
  role: 'user' | 'assistant'
  title: string
  content: string
  reportMarkdown?: string
  reportPath?: string
  createdAt: string
  trace: TraceItem[]
  progressUpdates?: ResearchProgressUpdate[]
  tools?: Array<Record<string, unknown>>
  runStartedAt?: string
  runCompletedAt?: string
  sourceQuestion?: string
  pending?: boolean
  stage?: AgentStage
  showMarkdown?: boolean
  runId?: string
  queryId?: string
}

export interface PatientMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  pending?: boolean
  failed?: boolean
}

export type PatientConversationMode = 'visit_preparation' | 'free_chat'
export const PATIENT_FREE_CHAT_TURN_LIMIT = 5
export type PatientSex = 'female' | 'male' | 'unspecified'
export type PregnancyStatus = 'yes' | 'no' | 'unsure' | 'not_applicable'

export interface PatientProfile {
  id: string
  name: string
  sex: PatientSex
  age?: number
  allergies: string
  pregnancy: PregnancyStatus
  memory: string
  createdAt: string
  updatedAt: string
}

export interface PatientIntakeSession {
  id: string
  title: string
  mode: PatientConversationMode
  profileId: string | null
  thinkingEnabled: boolean
  serverStarted: boolean
  createdAt: string
  updatedAt: string
  messages: PatientMessage[]
  visitSummary?: string
  reportPath?: string
}

export interface PatientIntakeResponse {
  contract_version: string
  session_id: string
  reply: string
  report_path?: string
}

export interface Session {
  id: string
  title: string
  researchSessionId: string | null
  clinicalQuestion: string
  status: ResearchSessionStatus
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export interface WorkspaceFile {
  path: string
  kind: 'report' | 'report_draft' | 'research_frame' | 'artifact'
  size: number
  modified_at: string
  media_type?: string
  previewable?: boolean
}

export interface WorkspaceFilesResponse {
  session_id: string
  files: WorkspaceFile[]
}

export type ClinicianDocumentKind = 'report' | 'report_draft' | 'research_frame' | 'artifact'

export interface ClinicianDocument extends Omit<WorkspaceFile, 'kind'> {
  kind: ClinicianDocumentKind
}

export interface ClinicianDocumentsResponse extends Omit<WorkspaceFilesResponse, 'files'> {
  files: ClinicianDocument[]
}

export interface WorkspaceFileResponse extends WorkspaceFile {
  session_id: string
  content: string
}

export interface CitationEvidenceExcerpt {
  claim: string
  quote: string
  relation: 'supports' | 'partially_supports' | 'refutes'
  provenance: string
  confidence: 'low' | 'moderate' | 'high'
  verified: true
  source: {
    title: string
    institution?: string
    url: string
  }
}

export interface CitationDetailResponse {
  number: number
  citation: string
  evidence: CitationEvidenceExcerpt[]
}

export interface WorkspaceAsset extends ClinicianDocument {
  id: string
  sessionId: string
  sessionTitle: string
  sessionUpdatedAt: string
}
