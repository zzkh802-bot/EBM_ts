import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { existingPiSessionDirectory } from "../session/sessionPath.js";

export class WorkspaceServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export type WorkspaceFile = {
  path: string;
  kind: "report" | "research_frame" | "evidence" | "source";
  size: number;
  modified_at: string;
};

export function safeSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new WorkspaceServiceError(422, "invalid_session_id", "无效的研究会话标识。 ");
  return sessionId;
}

export async function sessionWorkspace(rootDir: string, sessionId: string): Promise<string> {
  const safeId = safeSessionId(sessionId);
  const workspace = existingPiSessionDirectory(rootDir, safeId);
  if (!workspace) throw new WorkspaceServiceError(404, "workspace_not_found", "未找到该研究会话的工作区。 ");
  return workspace;
}

export async function safeWorkspaceFile(workspace: string, relativePath: string): Promise<string> {
  const lexicalPath = path.resolve(workspace, relativePath);
  if (!lexicalPath.startsWith(`${workspace}${path.sep}`)) throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(lexicalPath);
  } catch {
    throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  }
  if (!resolvedPath.startsWith(`${workspace}${path.sep}`)) throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  return resolvedPath;
}

export function workspaceFileKind(relativePath: string): WorkspaceFile["kind"] {
  if (relativePath === "notes/research_frame.md") return "research_frame";
  if (relativePath.startsWith("reports/")) return "report";
  if (relativePath.startsWith("evidence/")) return "evidence";
  return "source";
}

export function visibleWorkspacePath(relativePath: string): boolean {
  return relativePath === "notes/research_frame.md"
    || relativePath === "evidence/EVIDENCE.md"
    || /^reports\/(?!drafts\/).+\.md$/.test(relativePath)
    || /^evidence\/ev_[a-f0-9]{16}\.md$/.test(relativePath)
    || /^sources\/(?:read|search)\/.+\/(?:full|toc)\.md$/.test(relativePath);
}

export async function listWorkspaceFiles(workspace: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  const walk = async (relative = ""): Promise<void> => {
    const directory = path.join(workspace, relative);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && visibleWorkspacePath(child)) {
        const details = await stat(path.join(workspace, child));
        files.push({ path: child, kind: workspaceFileKind(child), size: details.size, modified_at: details.mtime.toISOString() });
      }
    }
  };
  await Promise.all(["notes", "reports", "evidence", "sources"].map((directory) => walk(directory)));
  return files.sort((left, right) => right.modified_at.localeCompare(left.modified_at));
}

export async function readWorkspaceFile(rootDir: string, sessionId: string, relativePath: string): Promise<WorkspaceFile & { session_id: string; content: string }> {
  if (!visibleWorkspacePath(relativePath)) throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  const workspace = await sessionWorkspace(rootDir, sessionId);
  const absolutePath = await safeWorkspaceFile(workspace, relativePath);
  let details;
  try {
    details = await stat(absolutePath);
  } catch {
    throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  }
  if (!details.isFile()) throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  return { session_id: sessionId, path: relativePath, kind: workspaceFileKind(relativePath), size: details.size, modified_at: details.mtime.toISOString(), content: await readFile(absolutePath, "utf8") };
}
