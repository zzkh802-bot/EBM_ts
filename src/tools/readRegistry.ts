import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ReadReceipt = {
  id: string;
  sourcePath: string;
  lineStart: number;
  lineEnd: number;
  sourceHash: string;
  preview: Array<{ line: number; text: string }>;
};

type PersistedRegistry = {
  version: 1;
  nextId: number;
  reads: ReadReceipt[];
};

const registries = new Map<string, Map<string, ReadReceipt>>();
const nextIds = new Map<string, number>();
const loading = new Map<string, Promise<string>>();
const persistQueues = new Map<string, Promise<void>>();

function registryKey(sessionDir: string): string {
  return path.resolve(sessionDir);
}

function registryPath(sessionDir: string): string {
  return path.join(sessionDir, "evidence", ".read-registry.json");
}

function previewLines(source: string, lineStart: number, lineEnd: number): Array<{ line: number; text: string }> {
  return source.split("\n").slice(lineStart - 1, lineEnd)
    .map((line, index) => ({ line: lineStart + index, text: line }))
    .filter((item) => item.text.trim())
    .slice(0, 2)
    .map((item) => ({ ...item, text: item.text.length > 180 ? `${item.text.slice(0, 180)}…` : item.text }));
}

async function persist(sessionDir: string): Promise<void> {
  const key = registryKey(sessionDir);
  const previous = persistQueues.get(key) ?? Promise.resolve();
  const current = previous.then(async () => {
    const reads = [...(registries.get(key)?.values() ?? [])];
    await mkdir(path.dirname(registryPath(sessionDir)), { recursive: true });
    const data: PersistedRegistry = {
      version: 1,
      nextId: nextIds.get(key) ?? 1,
      reads,
    };
    await writeFile(registryPath(sessionDir), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  });
  persistQueues.set(key, current.catch(() => undefined));
  await current;
}

async function ensureLoaded(sessionDir: string): Promise<string> {
  const key = registryKey(sessionDir);
  if (registries.has(key)) return key;
  const activeLoad = loading.get(key);
  if (activeLoad) return activeLoad;
  const load = ensureLoadedFromDisk(sessionDir, key);
  loading.set(key, load);
  try {
    return await load;
  } finally {
    if (loading.get(key) === load) loading.delete(key);
  }
}

async function ensureLoadedFromDisk(sessionDir: string, key: string): Promise<string> {
  const reads = new Map<string, ReadReceipt>();
  let nextId = 1;
  try {
    const parsed = JSON.parse(await readFile(registryPath(sessionDir), "utf8")) as Partial<PersistedRegistry>;
    if (Array.isArray(parsed.reads)) {
      for (const item of parsed.reads) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.sourcePath !== "string") continue;
        reads.set(item.id, item as ReadReceipt);
      }
    }
    if (Number.isSafeInteger(parsed.nextId) && (parsed.nextId as number) > 0) nextId = parsed.nextId as number;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  registries.set(key, reads);
  nextIds.set(key, nextId);
  return key;
}

export async function registerReadReceipt(input: {
  sessionDir: string;
  sourcePath: string;
  source: string;
  lineStart: number;
  lineEnd: number;
}): Promise<ReadReceipt> {
  const key = await ensureLoaded(input.sessionDir);
  const nextId = nextIds.get(key) ?? 1;
  const receipt: ReadReceipt = {
    id: `r${String(nextId).padStart(2, "0")}`,
    sourcePath: input.sourcePath.replaceAll("\\", "/"),
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    sourceHash: createHash("sha256").update(input.source).digest("hex"),
    preview: previewLines(input.source, input.lineStart, input.lineEnd),
  };
  registries.get(key)!.set(receipt.id, receipt);
  nextIds.set(key, nextId + 1);
  await persist(input.sessionDir);
  return receipt;
}

export async function listReadReceipts(sessionDir: string): Promise<ReadReceipt[]> {
  await ensureLoaded(sessionDir);
  return [...registries.get(registryKey(sessionDir))!.values()];
}

export async function resolveReadReceipt(sessionDir: string, id: string): Promise<ReadReceipt> {
  await ensureLoaded(sessionDir);
  const receipt = registries.get(registryKey(sessionDir))!.get(id);
  if (!receipt) throw new Error(`read_id was not found in this session: ${id}`);
  return receipt;
}

export function clearReadReceipts(sessionDir: string): void {
  const key = registryKey(sessionDir);
  registries.delete(key);
  nextIds.delete(key);
}
