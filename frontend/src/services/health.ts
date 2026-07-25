import { request } from './http'
export const healthService = {
  check: () => request<{ ok?: boolean; message?: string }>('/health', {}, 8_000),
}
