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
  kind: "report" | "report_draft" | "research_frame" | "artifact";
  size: number;
  modified_at: string;
  media_type: string;
  previewable: boolean;
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
  if (relativePath.startsWith("reports/drafts/") && relativePath.endsWith(".md")) return "report_draft";
  if (relativePath.startsWith("reports/")) return "report";
  return "artifact";
}

export function visibleWorkspacePath(relativePath: string): boolean {
  return relativePath === "notes/research_frame.md"
    || /^reports\/.+\.md$/.test(relativePath)
    || isUserArtifactPath(relativePath);
}

function isUserArtifactPath(relativePath: string): boolean {
  if (!relativePath.startsWith("artifacts/")) return false;
  const parts = relativePath.split("/");
  return parts.length > 1 && parts.every((part) => Boolean(part) && part !== "." && part !== ".." && !part.startsWith("."));
}

function mediaTypeForWorkspacePath(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return ({
    ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv",
    ".xml": "application/xml", ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".ts": "text/typescript", ".yaml": "text/yaml", ".yml": "text/yaml", ".pdf": "application/pdf",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function workspaceFileDetails(relativePath: string, size: number, modifiedAt: string): WorkspaceFile {
  const mediaType = mediaTypeForWorkspacePath(relativePath);
  return {
    path: relativePath,
    kind: workspaceFileKind(relativePath),
    size,
    modified_at: modifiedAt,
    media_type: mediaType,
    previewable: mediaType.startsWith("text/") || mediaType === "application/json" || mediaType === "application/xml",
  };
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
      else if (entry.isFile() && visibleWorkspacePath(child) && !child.startsWith("artifacts/uploads/") && !child.endsWith("/toc.md")) {
        const details = await stat(path.join(workspace, child));
        files.push(workspaceFileDetails(child, details.size, details.mtime.toISOString()));
      }
    }
  };
  await Promise.all(["notes", "reports", "artifacts"].map((directory) => walk(directory)));
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
  const metadata = workspaceFileDetails(relativePath, details.size, details.mtime.toISOString());
  return { session_id: sessionId, ...metadata, content: metadata.previewable ? await readFile(absolutePath, "utf8") : "" };
}

export async function readWorkspaceDownload(rootDir: string, sessionId: string, relativePath: string): Promise<WorkspaceFile & { bytes: Buffer }> {
  if (!visibleWorkspacePath(relativePath)) throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  const workspace = await sessionWorkspace(rootDir, sessionId);
  const absolutePath = await safeWorkspaceFile(workspace, relativePath);
  const details = await stat(absolutePath);
  if (!details.isFile()) throw new WorkspaceServiceError(404, "workspace_file_not_found", "未找到可展示的研究文件。 ");
  return { ...workspaceFileDetails(relativePath, details.size, details.mtime.toISOString()), bytes: await readFile(absolutePath) };
}
