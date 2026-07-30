import { request } from './http'
export const healthService = {
  check: () => request<{ ok?: boolean; message?: string }>('/ts-api/health', {}, 8_000),
}
