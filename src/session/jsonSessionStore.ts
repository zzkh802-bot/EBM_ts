import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type SessionMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt: string;
};

export type JsonSession = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  compacted?: Array<{ createdAt: string; summary: string; throughMessageId: string }>;
};

export class JsonSessionStore {
  constructor(public readonly rootDir: string) {}

  async create(userId: string, name: string): Promise<JsonSession> {
    const now = new Date().toISOString();
    const session: JsonSession = { id: randomUUID(), userId, name, createdAt: now, updatedAt: now, messages: [] };
    await this.save(session);
    return session;
  }

  pathFor(sessionId: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error("invalid session id");
    return path.join(this.rootDir, `${sessionId}.json`);
  }

  async load(sessionId: string): Promise<JsonSession> {
    return JSON.parse(await readFile(this.pathFor(sessionId), "utf8")) as JsonSession;
  }

  async save(session: JsonSession): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    session.updatedAt = new Date().toISOString();
    await writeFile(this.pathFor(session.id), `${JSON.stringify(session, null, 2)}\n`, "utf8");
  }

  async appendMessage(sessionId: string, message: Omit<SessionMessage, "id" | "createdAt">): Promise<JsonSession> {
    const session = await this.load(sessionId);
    session.messages.push({ id: randomUUID(), createdAt: new Date().toISOString(), ...message });
    await this.save(session);
    return session;
  }

  async addCompaction(sessionId: string, summary: string, throughMessageId: string): Promise<JsonSession> {
    const session = await this.load(sessionId);
    session.compacted ??= [];
    session.compacted.push({ createdAt: new Date().toISOString(), summary, throughMessageId });
    await this.save(session);
    return session;
  }
}
