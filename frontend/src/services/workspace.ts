import type { CitationDetailResponse, ClinicianDocument, ClinicianDocumentsResponse, SessionAttachmentsResponse, WorkspaceFile, WorkspaceFileResponse, WorkspaceFilesResponse } from '../types/domain'
import { request } from './http'

const base = (sessionId: string) => `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/files`
const attachmentBase = (sessionId: string) => `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/attachments`
const clinicianVisible = (file: WorkspaceFile): file is ClinicianDocument =>
  file.kind === 'report' || file.kind === 'report_draft' || file.kind === 'research_frame' || file.kind === 'artifact'
const isImplementationFile = (file: WorkspaceFile) => file.path.startsWith('artifacts/uploads/') || file.path.endsWith('/toc.md')

export const workspaceService = {
  async list(sessionId: string): Promise<ClinicianDocumentsResponse> {
    const workspace = await request<WorkspaceFilesResponse>(base(sessionId))
    const attachments = await request<SessionAttachmentsResponse>(attachmentBase(sessionId))
    const attachmentFiles: ClinicianDocument[] = attachments.attachments.map((attachment) => ({
      path: `attachments/${attachment.attachment_id}/${attachment.file_name}`,
      kind: 'attachment', size: attachment.size, modified_at: new Date().toISOString(), media_type: attachment.media_type,
      previewable: Boolean(attachment.processed_path), preview_path: attachment.processed_path,
    }))
    // The processed upload directory contains implementation files such as
    // `full.md` and `toc.md`; the attachment endpoint provides the single,
    // user-facing attachment entry instead.
    return { ...workspace, files: [...workspace.files.filter((file) => clinicianVisible(file) && !isImplementationFile(file)), ...attachmentFiles] }
  },
  async read(sessionId: string, path: string) {
    if (!path.startsWith('attachments/')) return request<WorkspaceFileResponse>(`${base(sessionId)}?path=${encodeURIComponent(path)}`)
    const attachmentId = path.split('/')[1] || ''
    const { attachments } = await request<SessionAttachmentsResponse>(attachmentBase(sessionId))
    const attachment = attachments.find((item) => item.attachment_id === attachmentId)
    if (attachment?.processed_path) return request<WorkspaceFileResponse>(`${base(sessionId)}?path=${encodeURIComponent(attachment.processed_path)}`)
    return { session_id: sessionId, path, kind: 'attachment' as const, size: 0, media_type: 'application/octet-stream', previewable: false, content: '' }
  },
  downloadUrl: (sessionId: string, path: string) => path.startsWith('attachments/')
    ? `${attachmentBase(sessionId)}/${encodeURIComponent(path.split('/')[1] || '')}`
    : `${base(sessionId)}?path=${encodeURIComponent(path)}&download=1`,
  attachmentPreviewUrl: (sessionId: string, path: string) =>
    `${attachmentBase(sessionId)}/${encodeURIComponent(path.split('/')[1] || '')}?inline=1`,
  citation: (sessionId: string, reportPath: string, number: string) => request<CitationDetailResponse>(
    `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/citations?report_path=${encodeURIComponent(reportPath)}&number=${encodeURIComponent(number)}`,
  ),
}
