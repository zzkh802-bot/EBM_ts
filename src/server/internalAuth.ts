import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";

const COOKIE_NAME = "ebm_internal_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const PASSWORD_MIN_LENGTH = 6;
const USER_ID_PATTERN = /^u-[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export type InternalUser = { id: string; display_name?: string };

type Session = { user: InternalUser; expiresAt: number };
type LoginAttempts = { count: number; resetAt: number };
type StoredUser = { id: string; display_name?: string; salt: string; password_hash: string; created_at: string };
type UserFile = { version: 1; users: StoredUser[] };
export type RegistrationResult =
  | { ok: true; token: string; user: InternalUser }
  | { ok: false; code: "invalid_invite" | "invalid_password" | "storage_error" };

/** Persistent account registry plus short-lived sessions for the internal annotation beta. */
export class InternalAuthStore {
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, LoginAttempts>();
  private readonly usersFile?: string;
  private readonly sessionsFile?: string;
  private users = new Map<string, StoredUser>();
  private persistedSessions = new Map<string, Session>();
  private writeQueue = Promise.resolve();

  constructor(private readonly accessKey?: string, rootDir?: string) {
    if (rootDir) {
      this.usersFile = path.join(path.resolve(rootDir), "data", "internal-users.json");
      this.sessionsFile = path.join(path.resolve(rootDir), "data", "internal-sessions.json");
      this.loadUsers();
      this.loadSessions();
    }
  }

  get enabled(): boolean { return Boolean(this.accessKey); }

  async register(displayNameValue: unknown, passwordValue: unknown, inviteValue: unknown, clientKey = "unknown"): Promise<RegistrationResult> {
    if (!this.allowAttempt(clientKey)) return { ok: false, code: "invalid_invite" };
    if (!this.accessKey || !constantTimeEqual(inviteValue, this.accessKey)) return { ok: false, code: "invalid_invite" };
    if (typeof passwordValue !== "string" || passwordValue.length < PASSWORD_MIN_LENGTH || passwordValue.length > 256) return { ok: false, code: "invalid_password" };
    const id = this.newUserId();
    const displayName = normalizeDisplayName(displayNameValue);
    const salt = randomBytes(16).toString("hex");
    const stored: StoredUser = {
      id, ...(displayName ? { display_name: displayName } : {}), salt,
      password_hash: hashPassword(passwordValue, salt), created_at: new Date().toISOString(),
    };
    this.users.set(id, stored);
    try { await this.persistUsers(); } catch {
      this.users.delete(id);
      return { ok: false, code: "storage_error" };
    }
    return { ok: true, ...this.issueSession(toPublicUser(stored)) };
  }

  login(userIdValue: unknown, passwordValue: unknown, clientKey = "unknown"): { token: string; user: InternalUser } | undefined {
    if (!this.allowAttempt(clientKey)) return undefined;
    const userId = normalizeUserId(userIdValue);
    if (!userId || typeof passwordValue !== "string") return undefined;
    const stored = this.users.get(userId);
    if (!stored || !verifyPassword(passwordValue, stored.salt, stored.password_hash)) return undefined;
    return this.issueSession(toPublicUser(stored));
  }

  authenticate(request: IncomingMessage): InternalUser | undefined {
    if (!this.enabled) return undefined;
    const token = bearerToken(request) ?? cookieToken(request);
    if (!token) return undefined;
    const session = this.sessions.get(token) ?? this.persistedSessions.get(tokenHash(token));
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      this.persistedSessions.delete(tokenHash(token));
      void this.persistSessions().catch(() => undefined);
      return undefined;
    }
    this.sessions.set(token, session);
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session.user;
  }

  logout(request: IncomingMessage): void {
    const token = bearerToken(request) ?? cookieToken(request);
    if (token) {
      this.sessions.delete(token);
      this.persistedSessions.delete(tokenHash(token));
      void this.persistSessions().catch(() => undefined);
    }
  }

  cookie(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}${secure ? "; Secure" : ""}`;
  }

  clearCookie(secure: boolean): string { return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`; }

  private issueSession(user: InternalUser): { token: string; user: InternalUser } {
    const token = randomBytes(32).toString("base64url");
    const session = { user, expiresAt: Date.now() + SESSION_TTL_MS };
    this.sessions.set(token, session);
    this.persistedSessions.set(tokenHash(token), session);
    void this.persistSessions().catch(() => undefined);
    this.prune();
    return { token, user };
  }

  private loadUsers(): void {
    if (!this.usersFile) return;
    try {
      const parsed = JSON.parse(readFileSync(this.usersFile, "utf8")) as Partial<UserFile>;
      if (parsed.version === 1 && Array.isArray(parsed.users)) {
        this.users = new Map(parsed.users.filter(isStoredUser).map((user) => [user.id, user]));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }

  private async persistUsers(): Promise<void> {
    if (!this.usersFile) throw new Error("User storage is not configured");
    this.writeQueue = this.writeQueue.then(async () => {
      const directory = path.dirname(this.usersFile!);
      await mkdir(directory, { recursive: true });
      const temporary = `${this.usersFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ version: 1, users: [...this.users.values()] }, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.usersFile!);
    });
    await this.writeQueue;
  }

  private loadSessions(): void {
    if (!this.sessionsFile) return;
    try {
      const parsed = JSON.parse(readFileSync(this.sessionsFile, "utf8")) as { sessions?: unknown };
      if (Array.isArray(parsed.sessions)) {
        this.persistedSessions = new Map(parsed.sessions.filter(isPersistedSession).map((item) => [item.token_hash, { user: item.user, expiresAt: item.expires_at }]));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }

  private async persistSessions(): Promise<void> {
    if (!this.sessionsFile) return;
    const directory = path.dirname(this.sessionsFile);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.sessionsFile}.${process.pid}.tmp`;
    const sessions = [...this.persistedSessions.entries()].map(([token_hash, session]) => ({ token_hash, user: session.user, expires_at: session.expiresAt }));
    await writeFile(temporary, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.sessionsFile);
  }

  private newUserId(): string {
    let id = "";
    do { id = `u-${randomReadable(8)}`; } while ([...this.users.values()].some((user) => user.id === id));
    return id;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    for (const [hash, session] of this.persistedSessions) if (session.expiresAt <= now) this.persistedSessions.delete(hash);
    if (this.sessions.size <= 2_000) return;
    const oldest = [...this.sessions.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt).slice(0, this.sessions.size - 2_000);
    for (const [token] of oldest) this.sessions.delete(token);
  }

  private allowAttempt(clientKey: string): boolean {
    const now = Date.now();
    const current = this.attempts.get(clientKey);
    if (!current || current.resetAt <= now) { this.attempts.set(clientKey, { count: 1, resetAt: now + 60_000 }); return true; }
    if (current.count >= 12) return false;
    current.count += 1;
    return true;
  }
}

export function normalizeUserId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const userId = value.trim().toLowerCase();
  return USER_ID_PATTERN.test(userId) ? userId : undefined;
}

function normalizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const displayName = value.trim().replace(/\s+/g, " ");
  return displayName ? displayName.slice(0, 80) : undefined;
}

function toPublicUser(user: StoredUser): InternalUser {
  return { id: user.id, ...(user.display_name ? { display_name: user.display_name } : {}) };
}

function hashPassword(password: string, salt: string): string { return scryptSync(password, salt, 32).toString("hex"); }
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  try { return timingSafeEqual(Buffer.from(hashPassword(password, salt), "hex"), Buffer.from(expectedHex, "hex")); } catch { return false; }
}

function isPersistedSession(value: unknown): value is { token_hash: string; user: InternalUser; expires_at: number } {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<{ token_hash: string; user: InternalUser; expires_at: number }>;
  return typeof session.token_hash === "string"
    && Boolean(session.user && typeof session.user.id === "string" && USER_ID_PATTERN.test(session.user.id))
    && typeof session.expires_at === "number";
}

function isStoredUser(value: unknown): value is StoredUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<StoredUser>;
  return typeof user.id === "string" && USER_ID_PATTERN.test(user.id) && typeof user.salt === "string" && typeof user.password_hash === "string" && typeof user.created_at === "string";
}

function randomReadable(length: number): string {
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

function constantTimeEqual(value: unknown, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value); const target = Buffer.from(expected);
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
    try { return decodeURIComponent(rest.join("=")) || undefined; } catch { return undefined; }
  }
  return undefined;
}
