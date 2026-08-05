import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class SessionOwnershipError extends Error {
  constructor(readonly code: "session_not_owned" | "session_owner_conflict") {
    super(code === "session_not_owned" ? "该研究会话不属于当前用户。" : "该研究会话已经属于另一位用户。 ");
  }
}

/** Small durable ownership index for the single-process internal beta server. */
export class SessionOwnershipStore {
  private readonly file: string;
  private owners = new Map<string, string>();
  private loaded?: Promise<void>;
  private writeQueue = Promise.resolve();

  constructor(rootDir: string) {
    this.file = path.join(path.resolve(rootDir), "data", "session-owners.json");
  }

  async claim(sessionId: string, userId: string): Promise<void> {
    await this.load();
    const existing = this.owners.get(sessionId);
    if (existing && existing !== userId) throw new SessionOwnershipError("session_owner_conflict");
    if (existing === userId) return;
    this.owners.set(sessionId, userId);
    await this.persist();
  }

  async assertOwner(sessionId: string, userId: string): Promise<void> {
    await this.load();
    if (this.owners.get(sessionId) !== userId) throw new SessionOwnershipError("session_not_owned");
  }

  private async load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = readFile(this.file, "utf8")
        .then((raw) => {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          this.owners = new Map(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        })
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        });
    }
    await this.loaded;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const directory = path.dirname(this.file);
      await mkdir(directory, { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(Object.fromEntries(this.owners), null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    await this.writeQueue;
  }
}
