import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { safeWorkspaceFile, sessionWorkspace, WorkspaceServiceError } from "./workspaceService.js";

export type FinalReportRevision = {
  path: string;
  markdown: string;
  modified: number;
  revision: string;
};

/** Read only formal reports and their verified sidecars for run completion detection. */
export async function readFinalReportRevisions(rootDir: string, sessionId: string): Promise<FinalReportRevision[]> {
  try {
    const workspace = await sessionWorkspace(rootDir, sessionId);
    const reportsDir = path.join(workspace, "reports");
    const entries = (await readdir(reportsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
    return await Promise.all(entries.map(async (entry) => {
      const file = path.join(reportsDir, entry.name);
      const metadata = await safeWorkspaceFile(workspace, path.posix.join("reports", `${entry.name}.metadata.json`))
        .then((metadataPath) => readFile(metadataPath, "utf8"))
        .catch(() => "");
      const [details, markdown] = await Promise.all([stat(file), readFile(file, "utf8")]);
      const normalizedMarkdown = markdown.trim();
      const contentHash = createHash("sha256").update(normalizedMarkdown).update("\0").update(metadata).digest("hex");
      return {
        path: path.posix.join("reports", entry.name),
        markdown: normalizedMarkdown,
        modified: details.mtimeMs,
        revision: `${details.mtimeMs}:${contentHash}`,
      };
    }));
  } catch (error) {
    // A session may not have a reports directory yet while a run is starting.
    // Preserve that normal empty state, but do not hide permission, I/O, or
    // malformed-workspace failures behind a false "no report" result.
    if (error instanceof WorkspaceServiceError && error.status === 404) return [];
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
