import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type QueryMetadata = {
  schema_version: 1;
  query_id: string;
  session_id: string;
  user_id?: string;
  question: string;
  created_at: string;
};

const queryIdPattern = /^[0-9a-f-]{20,64}$/i;

export async function writeQueryMetadata(sessionDir: string, metadata: QueryMetadata): Promise<void> {
  if (!queryIdPattern.test(metadata.query_id)) throw new Error("invalid query id");
  const traceDir = path.join(sessionDir, "trace");
  await mkdir(path.join(traceDir, "queries"), { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(metadata, null, 2)}\n`;
  await writeFile(path.join(traceDir, "queries", `${metadata.query_id}.json`), serialized, { encoding: "utf8", mode: 0o600 });
  await writeFile(path.join(traceDir, "current-query.json"), serialized, { encoding: "utf8", mode: 0o600 });
}

export async function readCurrentQueryMetadata(sessionDir: string): Promise<QueryMetadata | undefined> {
  const currentPath = path.join(sessionDir, "trace", "current-query.json");
  try {
    const value = JSON.parse(await readFile(currentPath, "utf8")) as QueryMetadata;
    if (!queryIdPattern.test(value.query_id) || typeof value.session_id !== "string" || (value.user_id !== undefined && typeof value.user_id !== "string") || typeof value.question !== "string") return undefined;
    return value;
  } catch {
    return undefined;
  } finally {
    await unlink(currentPath).catch(() => undefined);
  }
}

export async function queryMetadataExists(sessionDir: string, sessionId: string, queryId: string): Promise<boolean> {
  if (!queryIdPattern.test(queryId)) return false;
  try {
    const value = JSON.parse(await readFile(path.join(sessionDir, "trace", "queries", `${queryId}.json`), "utf8")) as QueryMetadata;
    return value.query_id === queryId && value.session_id === sessionId && typeof value.question === "string";
  } catch {
    return false;
  }
}
