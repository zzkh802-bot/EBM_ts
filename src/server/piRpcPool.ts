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

/** Owns native Pi RPC process reuse, session affinity, eviction, and failure cleanup. */
export class PiRpcSessionPool<TClient extends PoolablePiRpcClient> {
  private readonly sessions = new Map<string, PoolEntry<TClient>>();

  constructor(private readonly maximumSessions = 8) {}

  async run<TResult>(input: {
    requestedSessionId?: string;
    runtimeKey: string;
    createClient: () => Promise<TClient> | TClient;
    execute: (client: TClient, sessionId: string) => Promise<TResult>;
  }): Promise<TResult> {
    let pooled = input.requestedSessionId ? this.sessions.get(input.requestedSessionId) : undefined;
    if (pooled && pooled.runtimeKey !== input.runtimeKey) {
      await this.remove(pooled);
      pooled = undefined;
    }
    if (!pooled) {
      const client = await input.createClient();
      try {
        await client.start();
        const state = await client.getState();
        pooled = {
          client,
          sessionId: state.sessionId,
          runtimeKey: input.runtimeKey,
          running: false,
          lastUsed: Date.now(),
        };
        this.sessions.set(state.sessionId, pooled);
        await this.evict(pooled);
      } catch (error) {
        await client.stop().catch(() => undefined);
        throw error;
      }
    }
    if (pooled.running) throw new Error("该会话仍在生成回答，请等待当前回答完成后再继续。");
    pooled.running = true;
    try {
      return await input.execute(pooled.client, pooled.sessionId);
    } catch (error) {
      await this.remove(pooled);
      throw error;
    } finally {
      pooled.running = false;
      pooled.lastUsed = Date.now();
    }
  }

  async dispose(): Promise<void> {
    const clients = [...new Set([...this.sessions.values()].map((entry) => entry.client))];
    this.sessions.clear();
    await Promise.all(clients.map((client) => client.stop().catch(() => undefined)));
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
