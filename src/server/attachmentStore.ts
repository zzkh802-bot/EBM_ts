import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_RUN = 8;
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp", "gif", "txt", "md"]);

export type StoredAttachment = {
  id: string;
  userId: string;
  fileName: string;
  mediaType: string;
  size: number;
  path: string;
  clientSessionId?: string;
  processedPath?: string;
};

export class AttachmentStoreError extends Error {
  constructor(readonly code: "invalid_attachment" | "attachment_not_found") {
    super(code === "invalid_attachment" ? "附件格式或大小不符合要求。" : "未找到该附件，或附件不属于当前用户。 ");
  }
}

export class AttachmentStore {
  constructor(private readonly rootDir: string) {}

  async create(userId: string, fileName: string, mediaType: string, bytes: Uint8Array, clientSessionId?: string): Promise<StoredAttachment> {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentStoreError("invalid_attachment");
    const safeName = safeFileName(fileName);
    const id = `att_${randomBytes(12).toString("hex")}`;
    const directory = path.join(this.rootDir, "data", "attachments", userHash(userId), id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stored: StoredAttachment = { id, userId, fileName: safeName, mediaType: mediaType || mediaTypeFor(safeName), size: bytes.byteLength, path: path.join(directory, "original", safeName), ...(clientSessionId ? { clientSessionId } : {}) };
    await mkdir(path.dirname(stored.path), { recursive: true, mode: 0o700 });
    await writeFile(stored.path, bytes, { mode: 0o600 });
    await writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    return stored;
  }

  async resolve(userId: string, id: string): Promise<StoredAttachment> {
    if (!/^att_[a-f0-9]{24}$/.test(id)) throw new AttachmentStoreError("attachment_not_found");
    const metadataPath = path.join(this.rootDir, "data", "attachments", userHash(userId), id, "metadata.json");
    try {
      const stored = JSON.parse(await readFile(metadataPath, "utf8")) as StoredAttachment;
      if (stored.userId !== userId || stored.id !== id) throw new Error("owner mismatch");
      return stored;
    } catch {
      throw new AttachmentStoreError("attachment_not_found");
    }
  }

  async resolveMany(userId: string, ids: string[]): Promise<StoredAttachment[]> {
    if (ids.length > MAX_ATTACHMENTS_PER_RUN) throw new AttachmentStoreError("invalid_attachment");
    return Promise.all(ids.map((id) => this.resolve(userId, id)));
  }

  async markProcessed(attachment: StoredAttachment, sessionId: string, processedPath: string): Promise<StoredAttachment> {
    const stored = await this.resolve(attachment.userId, attachment.id);
    const updated: StoredAttachment = { ...stored, clientSessionId: sessionId, processedPath };
    await writeFile(path.join(path.dirname(path.dirname(stored.path)), "metadata.json"), `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    return updated;
  }

  async listForSession(userId: string, sessionId: string, legacySessionId?: string): Promise<StoredAttachment[]> {
    const root = path.join(this.rootDir, "data", "attachments", userHash(userId));
    const sessionIds = new Set([sessionId, ...(legacySessionId ? [legacySessionId] : [])]);
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
    const attachments = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        const stored = JSON.parse(await readFile(path.join(root, entry.name, "metadata.json"), "utf8")) as StoredAttachment;
        return stored.userId === userId && stored.clientSessionId && sessionIds.has(stored.clientSessionId) ? stored : undefined;
      } catch { return undefined; }
    }));
    return attachments.filter((attachment): attachment is StoredAttachment => Boolean(attachment));
  }
}

export function safeFileName(value: string): string {
  const base = path.basename(value).normalize("NFKC").trim();
  const extension = path.extname(base).slice(1).toLowerCase();
  if (!base || base.length > 160 || base.includes("\0") || !ALLOWED_EXTENSIONS.has(extension) || !/^[\p{L}\p{N}._()\- ]+$/u.test(base)) throw new AttachmentStoreError("invalid_attachment");
  return base;
}

export function mediaTypeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return ({ ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".txt": "text/plain", ".md": "text/markdown" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function userHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 20);
}
