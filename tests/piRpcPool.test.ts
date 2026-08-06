import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CONCURRENT_SESSIONS, parseMaxConcurrentSessions, PiRpcSessionPool, type PoolablePiRpcClient } from "../src/server/piRpcPool.js";

class FakeClient implements PoolablePiRpcClient {
  starts = 0;
  stops = 0;

  constructor(readonly sessionId: string, private readonly beforeState: () => Promise<void> = async () => undefined) {}

  async start() { this.starts += 1; }
  async stop() { this.stops += 1; }
  async getState() {
    await this.beforeState();
    return { sessionId: this.sessionId };
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("PiRpcSessionPool", () => {
  it("uses eight sessions by default and accepts a bounded environment override", () => {
    expect(DEFAULT_MAX_CONCURRENT_SESSIONS).toBe(8);
    expect(parseMaxConcurrentSessions("32")).toBe(32);
    expect(parseMaxConcurrentSessions("0")).toBe(8);
    expect(parseMaxConcurrentSessions("not-a-number")).toBe(8);
    expect(parseMaxConcurrentSessions("501")).toBe(8);
  });

  it("starts only one process when the same persisted session is resumed concurrently", async () => {
    const pool = new PiRpcSessionPool<FakeClient>();
    const stateGate = deferred();
    const executionGate = deferred();
    let creations = 0;
    const run = () => pool.run({
      requestedSessionId: "persisted-session",
      runtimeKey: "runtime",
      createClient: () => {
        creations += 1;
        return new FakeClient("persisted-session", () => stateGate.promise);
      },
      execute: async () => {
        await executionGate.promise;
        return "done";
      },
    });

    const first = run();
    await Promise.resolve();
    const second = run();
    stateGate.resolve();
    await Promise.resolve();
    executionGate.resolve();

    await first;
    await second.catch(() => undefined);
    expect(creations).toBe(1);
    await pool.dispose();
  });

  it("never starts a process beyond capacity and admits a new session after one becomes idle", async () => {
    const pool = new PiRpcSessionPool<FakeClient>(1);
    const firstGate = deferred();
    const firstClient = new FakeClient("first");
    const secondClient = new FakeClient("second");

    const first = pool.run({
      runtimeKey: "runtime",
      createClient: () => firstClient,
      execute: async () => { await firstGate.promise; },
    });
    await Promise.resolve();
    await expect(pool.run({
      runtimeKey: "runtime",
      createClient: () => secondClient,
      execute: async () => undefined,
    })).rejects.toThrow(/并发上限/);
    expect(secondClient.starts).toBe(0);

    firstGate.resolve();
    await first;
    await pool.run({
      runtimeKey: "runtime",
      createClient: () => secondClient,
      execute: async () => undefined,
    });

    expect(firstClient.stops).toBe(1);
    expect(secondClient.stops).toBe(0);
    await pool.dispose();
  });
});
