import type { ClinicianDocument, ClinicianDocumentsResponse, WorkspaceFile, WorkspaceFileResponse, WorkspaceFilesResponse } from '../types/domain'
import { request } from './http'

const base = (sessionId: string) => `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/files`
const clinicianVisible = (file: WorkspaceFile): file is ClinicianDocument =>
  file.kind === 'report' || file.kind === 'research_frame'

export const workspaceService = {
  async list(sessionId: string): Promise<ClinicianDocumentsResponse> {
    const workspace = await request<WorkspaceFilesResponse>(base(sessionId))
    return { ...workspace, files: workspace.files.filter(clinicianVisible) }
  },
  read: (sessionId: string, path: string) => request<WorkspaceFileResponse>(`${base(sessionId)}?path=${encodeURIComponent(path)}`),
}
