import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("vendored Pi RPC diagnostic boundary", () => {
  it("does not mirror or expose credential-shaped child stderr", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ebm-rpc-security-"));
    const cliPath = path.join(directory, "fake-rpc.js");
    await writeFile(cliPath, 'process.stderr.write("token=RPC_TEST_SENTINEL\\n");\n', "utf8");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const client = new RpcClient({ cliPath });

    let failure = "";
    try {
      await client.start();
      await client.getState();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      await client.stop();
    }

    expect(failure).not.toContain("RPC_TEST_SENTINEL");
    expect(failure).toContain("[redacted]");
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("RPC_TEST_SENTINEL");
  });
});
