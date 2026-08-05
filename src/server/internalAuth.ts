import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const COOKIE_NAME = "ebm_internal_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;

export type InternalUser = { id: string; username: string };

type Session = { user: InternalUser; expiresAt: number };
type LoginAttempts = { count: number; resetAt: number };

/** Lightweight shared-key gate for the internal annotation beta. */
export class InternalAuthStore {
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, LoginAttempts>();

  constructor(private readonly accessKey?: string) {}

  get enabled(): boolean {
    return Boolean(this.accessKey);
  }

  login(usernameValue: unknown, accessKeyValue: unknown, clientKey = "unknown"): { token: string; user: InternalUser } | undefined {
    if (!this.allowAttempt(clientKey)) return undefined;
    const username = normalizeUsername(usernameValue);
    if (!username || !this.accessKey || !constantTimeEqual(accessKeyValue, this.accessKey)) return undefined;
    const user = { id: username, username };
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
    this.prune();
    return { token, user };
  }

  authenticate(request: IncomingMessage): InternalUser | undefined {
    if (!this.enabled) return undefined;
    const token = bearerToken(request) ?? cookieToken(request);
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session.user;
  }

  logout(request: IncomingMessage): void {
    const token = bearerToken(request) ?? cookieToken(request);
    if (token) this.sessions.delete(token);
  }

  cookie(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}${secure ? "; Secure" : ""}`;
  }

  clearCookie(secure: boolean): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    if (this.sessions.size <= 2_000) return;
    const oldest = [...this.sessions.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt).slice(0, this.sessions.size - 2_000);
    for (const [token] of oldest) this.sessions.delete(token);
  }

  private allowAttempt(clientKey: string): boolean {
    const now = Date.now();
    const current = this.attempts.get(clientKey);
    if (!current || current.resetAt <= now) {
      this.attempts.set(clientKey, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (current.count >= 12) return false;
    current.count += 1;
    return true;
  }
}

export function normalizeUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const username = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(username) ? username : undefined;
}

function constantTimeEqual(value: unknown, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function bearerToken(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || undefined : undefined;
}

function cookieToken(request: IncomingMessage): string | undefined {
  const raw = request.headers.cookie ?? "";
  for (const item of raw.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(rest.join("=")) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
