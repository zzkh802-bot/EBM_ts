import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatBeijingDate, formatBeijingTimestamp } from "../tools/time.js";

const workspaceCache = new Map<string, string>();
const workspaceInitializations = new Map<string, Promise<string>>();

function validateSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error("invalid Pi session id");
}

function sessionRoot(cwd: string): string {
  return path.join(cwd, "data", "sessions");
}

function mappingPath(cwd: string, sessionId: string): string {
  return path.join(sessionRoot(cwd), ".metadata", "workspaces", `${sessionId}.json`);
}

function cacheKey(cwd: string, sessionId: string): string {
  return `${path.resolve(cwd)}\0${sessionId}`;
}

function safeWorkspaceDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value === "." || value === ".." || path.basename(value) !== value) return undefined;
  return value;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeExistingWorkspace(cwd: string, workspace: string): string | undefined {
  try {
    if (!lstatSync(workspace).isDirectory()) return undefined;
    const rootReal = realpathSync(sessionRoot(cwd));
    const workspaceReal = realpathSync(workspace);
    if (!isInside(rootReal, workspaceReal)) return undefined;
    return workspaceReal;
  } catch {
    return undefined;
  }
}

function mappedWorkspace(cwd: string, sessionId: string): string | undefined {
  const cached = workspaceCache.get(cacheKey(cwd, sessionId));
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(mappingPath(cwd, sessionId), "utf8")) as { directory?: unknown };
    const directory = safeWorkspaceDirectory(parsed.directory);
    if (!directory) return undefined;
    const resolved = safeExistingWorkspace(cwd, path.join(sessionRoot(cwd), directory));
    if (!resolved) return undefined;
    const metadata = JSON.parse(readFileSync(path.join(resolved, ".metadata", "session.json"), "utf8")) as { sessionId?: unknown };
    if (metadata.sessionId !== sessionId) return undefined;
    workspaceCache.set(cacheKey(cwd, sessionId), resolved);
    return resolved;
  } catch {
    return undefined;
  }
}

function semanticSlug(value: string): string {
  const normalized = value.normalize("NFKC").toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(normalized).slice(0, 64).join("").replace(/-+$/g, "") || "research";
}

export function piSessionDirectory(cwd: string, sessionId: string): string {
  validateSessionId(sessionId);
  return mappedWorkspace(cwd, sessionId) ?? path.join(sessionRoot(cwd), sessionId);
}

export function piSessionCreatedDate(cwd: string, sessionId: string): string | undefined {
  const workspace = piSessionDirectory(cwd, sessionId);
  try {
    const metadata = JSON.parse(readFileSync(path.join(workspace, ".metadata", "session.json"), "utf8")) as { createdAt?: unknown };
    if (typeof metadata.createdAt !== "string") return undefined;
    const date = new Date(metadata.createdAt);
    if (Number.isNaN(date.getTime())) return undefined;
    return formatBeijingDate(date);
  } catch {
    return undefined;
  }
}

export function piReadableSessionPath(cwd: string, sessionId: string, relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("invalid session-relative path");
  }
  return ["data", "sessions", path.basename(piSessionDirectory(cwd, sessionId)), normalized].join("/");
}

export function registerSessionWorkspace(pi: Pick<ExtensionAPI, "on">): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionName = ctx.sessionManager.getSessionName();
    await initializePiSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId(), {
      ...(sessionName ? { sessionName } : {}),
      firstPrompt: event.prompt,
    });
  });
}

export function initializePiSessionDirectory(cwd: string, sessionId: string, input: {
  sessionName?: string;
  firstPrompt: string;
}): Promise<string> {
  validateSessionId(sessionId);
  const key = cacheKey(cwd, sessionId);
  const active = workspaceInitializations.get(key);
  if (active) return active;
  const initialization = initializePiSessionDirectoryUnlocked(cwd, sessionId, input).finally(() => {
    if (workspaceInitializations.get(key) === initialization) workspaceInitializations.delete(key);
  });
  workspaceInitializations.set(key, initialization);
  return initialization;
}

async function initializePiSessionDirectoryUnlocked(cwd: string, sessionId: string, input: {
  sessionName?: string;
  firstPrompt: string;
}): Promise<string> {
  validateSessionId(sessionId);
  const existingMapping = mappedWorkspace(cwd, sessionId);
  if (existingMapping) return existingMapping;

  const root = sessionRoot(cwd);
  const label = input.sessionName?.trim() || input.firstPrompt.trim() || "research";
  await mkdir(root, { recursive: true, mode: 0o700 });
  const legacy = path.join(root, sessionId);
  if (existsSync(legacy)) {
    const safeLegacy = safeExistingWorkspace(cwd, legacy);
    if (!safeLegacy) throw new Error(`unsafe legacy workspace for session ${sessionId}`);
    const metadataDir = path.join(safeLegacy, ".metadata");
    const metadataFile = path.join(metadataDir, "session.json");
    const mappingsDir = path.dirname(mappingPath(cwd, sessionId));
    await mkdir(metadataDir, { recursive: true, mode: 0o700 });
    await mkdir(mappingsDir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(metadataFile, `${JSON.stringify({
        sessionId,
        directory: sessionId,
        displayName: label,
        createdAt: formatBeijingTimestamp(),
      }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      const existing = JSON.parse(await readFile(metadataFile, "utf8")) as { sessionId?: unknown };
      if (existing.sessionId !== sessionId) throw error;
    }
    const targetMapping = mappingPath(cwd, sessionId);
    try {
      await writeFile(targetMapping, `${JSON.stringify({ sessionId, directory: sessionId }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      const existing = JSON.parse(await readFile(targetMapping, "utf8")) as { directory?: unknown };
      if (existing.directory !== sessionId) throw error;
    }
    workspaceCache.set(cacheKey(cwd, sessionId), safeLegacy);
    return safeLegacy;
  }

  const baseDirectory = `${sessionId.slice(0, 8)}_${semanticSlug(label)}`;
  let directory = baseDirectory;
  let workspace = path.join(root, directory);
  for (let suffix = 2; existsSync(workspace); suffix += 1) {
    try {
      const metadata = JSON.parse(await readFile(path.join(workspace, ".metadata", "session.json"), "utf8")) as { sessionId?: unknown };
      if (metadata.sessionId === sessionId) break;
    } catch {
      // An incomplete or unrelated directory is a collision.
    }
    directory = `${baseDirectory}-${suffix}`;
    workspace = path.join(root, directory);
  }
  const workspaceMetadataDir = path.join(workspace, ".metadata");
  const mappingsDir = path.dirname(mappingPath(cwd, sessionId));
  let workspaceCreated = false;
  try {
    await mkdir(workspace, { recursive: false, mode: 0o700 });
    workspaceCreated = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existing = mappedWorkspace(cwd, sessionId);
    if (existing) return existing;
    try {
      const existingMetadata = JSON.parse(await readFile(path.join(workspaceMetadataDir, "session.json"), "utf8")) as { sessionId?: unknown };
      if (existingMetadata.sessionId !== sessionId) throw error;
    } catch {
      throw new Error(`workspace collision cannot be resolved for session ${sessionId}`);
    }
  }
  await mkdir(workspaceMetadataDir, { recursive: true, mode: 0o700 });
  await mkdir(mappingsDir, { recursive: true, mode: 0o700 });

  const metadata = {
    sessionId,
    directory,
    displayName: label,
    createdAt: formatBeijingTimestamp(),
  };
  await writeFile(path.join(workspaceMetadataDir, "session.json"), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const targetMapping = mappingPath(cwd, sessionId);
  try {
    await writeFile(targetMapping, `${JSON.stringify({ sessionId, directory }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    try {
      const parsed = JSON.parse(await readFile(targetMapping, "utf8")) as { directory?: unknown };
      const winner = safeWorkspaceDirectory(parsed.directory);
      if (winner) {
        const resolved = safeExistingWorkspace(cwd, path.join(root, winner));
        if (resolved) {
          const winnerMetadata = JSON.parse(await readFile(path.join(resolved, ".metadata", "session.json"), "utf8")) as { sessionId?: unknown };
          if (winnerMetadata.sessionId === sessionId) {
            if (workspaceCreated && resolved !== workspace) await rm(workspace, { recursive: true, force: true });
            workspaceCache.set(cacheKey(cwd, sessionId), resolved);
            return resolved;
          }
        }
      }
    } catch {
      // Preserve the original atomic mapping error below.
    }
    throw error;
  }
  workspaceCache.set(cacheKey(cwd, sessionId), workspace);
  return workspace;
}
