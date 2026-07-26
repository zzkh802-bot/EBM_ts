import type { ArchiveRun } from '../types/domain'
import { request } from './http'
export const archiveService = {
  recent: (limit = 30) => request<{ runs?: ArchiveRun[] }>(`/archive/recent?limit=${limit}`),
  detail: (id: string | number, limit = 300) =>
    request<Record<string, unknown>>(`/archive/detail?id=${encodeURIComponent(id)}&limit=${limit}`),
}
