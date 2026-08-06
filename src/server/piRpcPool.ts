export interface PoolablePiRpcClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<{ sessionId: string }>;
}

type PoolEntry<TClient extends PoolablePiRpcClient> = {
  client: TClient;
  sessionId: string;
  runtimeKey: string;
  running: boolean;
  lastUsed: number;
};

export const DEFAULT_MAX_CONCURRENT_SESSIONS = 8;

/** Parse the shared local Pi-process limit; invalid values keep the safe default. */
export function parseMaxConcurrentSessions(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 500
    ? parsed
    : DEFAULT_MAX_CONCURRENT_SESSIONS;
}

/** Owns native Pi RPC process reuse, session affinity, eviction, and failure cleanup. */
export class PiRpcSessionPool<TClient extends PoolablePiRpcClient> {
  private readonly sessions = new Map<string, PoolEntry<TClient>>();
  private readonly pendingSessions = new Map<string, Promise<PoolEntry<TClient>>>();
  private reservedSlots = 0;

  constructor(private readonly maximumSessions = DEFAULT_MAX_CONCURRENT_SESSIONS) {}

  async run<TResult>(input: {
    requestedSessionId?: string;
    runtimeKey: string;
    createClient: () => Promise<TClient> | TClient;
    execute: (client: TClient, sessionId: string) => Promise<TResult>;
  }): Promise<TResult> {
    let pooled = input.requestedSessionId ? this.sessions.get(input.requestedSessionId) : undefined;
    if (pooled && pooled.runtimeKey !== input.runtimeKey) {
      if (pooled.running) throw new Error("该会话仍在生成回答，请等待当前回答完成后再继续。");
      await this.remove(pooled);
      pooled = undefined;
    }
    if (!pooled) {
      const acquired = await this.acquire(input);
      pooled = acquired.entry;
      if (!acquired.owner) {
        if (pooled.runtimeKey !== input.runtimeKey || pooled.running) {
          throw new Error("该会话仍在生成回答，请等待当前回答完成后再继续。");
        }
        pooled.running = true;
      }
    } else {
      if (pooled.running) throw new Error("该会话仍在生成回答，请等待当前回答完成后再继续。");
      pooled.running = true;
    }
    try {
      return await input.execute(pooled.client, pooled.sessionId);
    } catch (error) {
      await this.remove(pooled);
      throw error;
    } finally {
      pooled.running = false;
      pooled.lastUsed = Date.now();
      await this.evict(pooled);
    }
  }

  async dispose(): Promise<void> {
    const clients = [...new Set([...this.sessions.values()].map((entry) => entry.client))];
    this.sessions.clear();
    await Promise.all(clients.map((client) => client.stop().catch(() => undefined)));
  }

  private async acquire(input: {
    requestedSessionId?: string;
    runtimeKey: string;
    createClient: () => Promise<TClient> | TClient;
  }): Promise<{ entry: PoolEntry<TClient>; owner: boolean }> {
    const key = input.requestedSessionId;
    if (key) {
      const pending = this.pendingSessions.get(key);
      if (pending) return { entry: await pending, owner: false };
    }

    const creation = this.createEntry(input.runtimeKey, input.createClient);
    if (!key) return { entry: await creation, owner: true };
    this.pendingSessions.set(key, creation);
    try {
      return { entry: await creation, owner: true };
    } finally {
      if (this.pendingSessions.get(key) === creation) this.pendingSessions.delete(key);
    }
  }

  private async createEntry(runtimeKey: string, createClient: () => Promise<TClient> | TClient): Promise<PoolEntry<TClient>> {
    await this.reserveSlot();
    let client: TClient | undefined;
    try {
      client = await createClient();
      await client.start();
      const state = await client.getState();
      const entry = {
        client,
        sessionId: state.sessionId,
        runtimeKey,
        running: true,
        lastUsed: Date.now(),
      };
      this.sessions.set(state.sessionId, entry);
      return entry;
    } catch (error) {
      await client?.stop().catch(() => undefined);
      throw error;
    } finally {
      this.reservedSlots -= 1;
    }
  }

  private async reserveSlot(): Promise<void> {
    while (this.sessions.size + this.reservedSlots >= this.maximumSessions) {
      const stale = [...this.sessions.values()]
        .filter((entry) => !entry.running)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!stale) throw new Error("研究服务已达到会话并发上限，请等待正在运行的任务完成后重试。");
      await this.remove(stale);
    }
    this.reservedSlots += 1;
  }

  private async evict(current: PoolEntry<TClient>): Promise<void> {
    if (this.sessions.size <= this.maximumSessions) return;
    const stale = [...this.sessions.values()]
      .filter((entry) => entry !== current && !entry.running)
      .sort((left, right) => left.lastUsed - right.lastUsed)[0];
    if (stale) await this.remove(stale);
  }

  private async remove(entry: PoolEntry<TClient>): Promise<void> {
    if (this.sessions.get(entry.sessionId) === entry) this.sessions.delete(entry.sessionId);
    await entry.client.stop().catch(() => undefined);
  }
}
