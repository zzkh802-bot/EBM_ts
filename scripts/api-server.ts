import path from "node:path";
import { AccountConnectionStore, createAgentApiServer, createPiRpcExecutor, loadRuntimeConfig } from "../src/server/agentApi.js";
import { createPiPatientIntakeExecutor } from "../src/server/patientIntake.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const port = parsePort(process.env.DP_XUNYI_TS_PORT, 8787);
const host = process.env.DP_XUNYI_TS_HOST?.trim() || "127.0.0.1";
const corsOrigin = process.env.DP_XUNYI_TS_CORS_ORIGIN?.trim() || "*";

const executor = createPiRpcExecutor({ rootDir });
const patientIntakeExecutor = createPiPatientIntakeExecutor({ rootDir });
const { server } = createAgentApiServer({
  executor,
  patientIntakeExecutor,
  corsOrigin,
  runtimeConfig: () => loadRuntimeConfig(rootDir),
  accountConnections: new AccountConnectionStore(rootDir),
  staticDir: path.join(rootDir, "frontend", "dist"),
  rootDir,
});

server.listen(port, host, () => {
  process.stdout.write(`循医研究服务监听于 http://${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(async () => {
    await Promise.all([executor.dispose(), patientIntakeExecutor.dispose()]);
    process.exit(0);
  }));
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("DP_XUNYI_TS_PORT must be a valid TCP port");
  return parsed;
}
