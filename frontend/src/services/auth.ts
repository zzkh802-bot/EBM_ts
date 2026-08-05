import type { InternalAuthConfig, InternalUser } from '../types/domain'
import { postJson, request } from './http'

const AUTH_BASE = '/ts-api/api/v1/auth'

export const authService = {
  config: () => request<InternalAuthConfig>(`${AUTH_BASE}/config`),
  me: () => request<{ user: InternalUser }>(`${AUTH_BASE}/me`),
  login: (username: string, password: string) => postJson<{ auth_required: boolean; user: InternalUser }>(`${AUTH_BASE}/login`, { username, password }),
  register: (username: string, displayName: string, password: string, inviteKey: string) => postJson<{ auth_required: boolean; user: InternalUser }>(`${AUTH_BASE}/register`, { username, display_name: displayName, password, invite_key: inviteKey }),
  logout: () => postJson<{ ok: true }>(`${AUTH_BASE}/logout`, {}),
}
