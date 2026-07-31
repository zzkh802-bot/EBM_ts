import type { WorkspaceFileResponse, WorkspaceFilesResponse } from '../types/domain'
import { request } from './http'

const base = (sessionId: string) => `/ts-api/api/v1/research-sessions/${encodeURIComponent(sessionId)}/files`

export const workspaceService = {
  list: (sessionId: string) => request<WorkspaceFilesResponse>(base(sessionId)),
  read: (sessionId: string, path: string) => request<WorkspaceFileResponse>(`${base(sessionId)}?path=${encodeURIComponent(path)}`),
}
