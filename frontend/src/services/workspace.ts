import type { CitationDetailResponse, ClinicianDocument, ClinicianDocumentsResponse, SessionAttachmentsResponse, WorkspaceFile, WorkspaceFileResponse, WorkspaceFilesResponse } from '../types/domain'
import { request } from './http'

const base = (sessionId: string) => `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/files`
const attachmentBase = (sessionId: string) => `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/attachments`
const clinicianVisible = (file: WorkspaceFile): file is ClinicianDocument =>
  file.kind === 'report' || file.kind === 'report_draft' || file.kind === 'research_frame' || file.kind === 'artifact'

export const workspaceService = {
  async list(sessionId: string): Promise<ClinicianDocumentsResponse> {
    const workspace = await request<WorkspaceFilesResponse>(base(sessionId))
    const attachments = await request<SessionAttachmentsResponse>(attachmentBase(sessionId))
    const attachmentFiles: ClinicianDocument[] = attachments.attachments.map((attachment) => ({
      path: `attachments/${attachment.attachment_id}/${attachment.file_name}`,
      kind: 'attachment', size: attachment.size, modified_at: new Date().toISOString(), media_type: attachment.media_type, previewable: false,
    }))
    return { ...workspace, files: [...workspace.files.filter(clinicianVisible), ...attachmentFiles] }
  },
  read: (sessionId: string, path: string) => path.startsWith('attachments/')
    ? Promise.resolve({ session_id: sessionId, path, kind: 'attachment' as const, size: 0, media_type: 'application/octet-stream', previewable: false, content: '' })
    : request<WorkspaceFileResponse>(`${base(sessionId)}?path=${encodeURIComponent(path)}`),
  downloadUrl: (sessionId: string, path: string) => path.startsWith('attachments/')
    ? `${attachmentBase(sessionId)}/${encodeURIComponent(path.split('/')[1] || '')}`
    : `${base(sessionId)}?path=${encodeURIComponent(path)}&download=1`,
  citation: (sessionId: string, reportPath: string, number: string) => request<CitationDetailResponse>(
    `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/citations?report_path=${encodeURIComponent(reportPath)}&number=${encodeURIComponent(number)}`,
  ),
}
