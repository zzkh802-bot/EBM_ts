import type { InternalAuthConfig, InternalUser } from '../types/domain'
import { postJson, request } from './http'

const AUTH_BASE = '/ts-api/api/v1/auth'

export const authService = {
  config: () => request<InternalAuthConfig>(`${AUTH_BASE}/config`),
  me: () => request<{ user: InternalUser }>(`${AUTH_BASE}/me`),
  login: (username: string, accessKey: string) => postJson<{ auth_required: boolean; user: InternalUser }>(`${AUTH_BASE}/login`, { username, access_key: accessKey }),
  logout: () => postJson<{ ok: true }>(`${AUTH_BASE}/logout`, {}),
}
