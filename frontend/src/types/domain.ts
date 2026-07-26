export type ResearchMode = 'instant' | 'expert'
export type AudienceMode = 'clinician' | 'public'
export type ThemeMode = 'light' | 'dark' | 'system'
export type BackendVersion = 'v1' | 'v2'

export interface ModeSnapshot {
  researchMode: ResearchMode
  audienceMode: AudienceMode
  deepThink: boolean
  searchEnabled: boolean
}

export interface AttachmentData {
  id: string
  name: string
  size: number
  type: string
  dataUrl: string
}

export interface AttachmentDto {
  name: string
  size: number
  type: string
  content_base64: string
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
}

export interface CitationAudit {
  ok?: boolean
  status?: string
  summary?: string
  issues?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface ArchiveRef {
  id?: string
  archive_id?: string | number
  run_id?: string
  title?: string
  backend?: string
  created_at?: string
  [key: string]: unknown
}

export interface AgentRequest {
  question: string
  stable_question: string
  stable_cache: true
  attachments: AttachmentDto[]
  ebm_session_id: string
  max_iterations: 5 | 12
  request_timeout_seconds: 300 | 600
  research_mode: ResearchMode
  audience_mode: AudienceMode
  deep_think: boolean
  search_enabled: boolean
}

export interface AgentResponse {
  ok?: boolean
  session_id?: string
  report_markdown?: string
  agent_answer?: string
  message?: string
  agent_trace?: TraceItem[]
  citation_audit?: CitationAudit | null
  archive?: ArchiveRef | null
  uploaded_texts?: Array<Record<string, unknown>>
  tools?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type AgentV2Status = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentV2Request {
  question: string
  session_id?: string
  research_mode: ResearchMode
  audience_mode: AudienceMode
  deep_think: boolean
  search_enabled: boolean
  max_iterations: 5 | 12
  request_timeout_seconds: 300 | 600
}

export interface AgentV2Response {
  contract_version: string
  run_id: string
  status: AgentV2Status
  created_at?: string
  started_at?: string
  completed_at?: string
  session_id?: string
  message?: string
  agent_answer?: string
  report_markdown?: string
  patient_summary?: string
  agent_trace?: TraceItem[]
  tools?: Array<Record<string, unknown>>
  summary?: Record<string, unknown>
  error?: { code: string; message: string }
}

export interface Message extends ModeSnapshot {
  id: string
  role: 'user' | 'assistant'
  title: string
  content: string
  createdAt: string
  trace: TraceItem[]
  attachments?: AttachmentData[]
  archive?: ArchiveRef | null
  citationAudit?: CitationAudit | null
  uploadedTexts?: Array<Record<string, unknown>>
  sourceQuestion?: string
  pending?: boolean
  stage?: AgentStage
  feedback?: 'up' | 'down' | ''
  showMarkdown?: boolean
  backendVersion?: BackendVersion
}

export interface Session {
  id: string
  title: string
  ebmSessionId: string | null
  v2SessionId: string | null
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export type AgentStage = 'idle' | 'planning' | 'retrieving' | 'tooling' | 'generating' | 'network_wait'

export interface KnowledgeItem {
  id: string
  name: string
  size: number
  type: string
  scope: 'personal' | 'public'
  status: string
  updatedAt: string
}

export interface ArchiveRun extends ArchiveRef {
  id?: string
  archive_id: string | number
  question?: string
  answer_preview?: string
  item_count?: number
  backend?: string
  status?: string
  created_at?: string
  report_markdown?: string
}

export interface LiteratureReliability {
  score?: number
  level?: 'high' | 'moderate' | 'screening' | string
  label?: string
  reasons?: string[]
}

export interface LiteratureItem {
  pmid?: string
  doi?: string
  url?: string
  title?: string
  article_title?: string
  summary?: string
  abstract?: string
  zh?: string
  journal?: string
  source?: string
  venue?: string
  date?: string
  publication_date?: string
  year?: string | number
  tags?: string[]
  publication_types?: string[]
  mesh_terms?: string[]
  source_database?: string
  retrieval_api?: string
  reliability?: LiteratureReliability
}

export interface LiteratureSearchResponse {
  ok?: boolean
  message?: string
  items?: LiteratureItem[]
  panel?: { sources?: { pubmed?: { items?: LiteratureItem[] } } }
  result?: { panel?: { sources?: { pubmed?: { items?: LiteratureItem[] } } } }
}
