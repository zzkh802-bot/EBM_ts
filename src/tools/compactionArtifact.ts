import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type CompactionArtifactInput = {
  sessionDir: string;
  sessionId: string;
  reason: "manual" | "threshold" | "overflow";
  willRetry: boolean;
  fromExtension: boolean;
  entry: {
    id: string;
    timestamp: string;
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: unknown;
  };
};

export async function saveCompactionArtifact(input: CompactionArtifactInput): Promise<{ path: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.entry.id)) throw new Error("invalid compaction entry id");
  const rel = path.posix.join("compactions", `${input.entry.id}.json`);
  const abs = path.join(input.sessionDir, rel);
  const temp = `${abs}.${process.pid}.tmp`;
  const artifact = {
    session_id: input.sessionId,
    compaction_entry_id: input.entry.id,
    timestamp: input.entry.timestamp,
    reason: input.reason,
    will_retry: input.willRetry,
    from_extension: input.fromExtension,
    first_kept_entry_id: input.entry.firstKeptEntryId,
    tokens_before: input.entry.tokensBefore,
    summary: input.entry.summary,
    ...(input.entry.details === undefined ? {} : { details: input.entry.details }),
  };
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(temp, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await rename(temp, abs);
  return { path: rel };
}
