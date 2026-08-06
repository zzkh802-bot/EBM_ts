import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashCommandPathAllowed, nativePathAllowed } from "../src/extensions/securityGuard.js";
import { initializePiSessionDirectory, piSessionDirectory } from "../src/session/sessionPath.js";

describe("native file tool path guard", () => {
  it("keeps native file tools inside the active session and blocks symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ebm-path-"));
    const sessionId = "guard-session";
    try {
      const workspace = await initializePiSessionDirectory(root, sessionId, { firstPrompt: "测试问题" });
      await mkdir(path.join(workspace, "artifacts"), { recursive: true });
      await mkdir(path.join(root, ".pi"), { recursive: true });
      await writeFile(path.join(root, ".pi", "SKILL.md"), "rules", "utf8");
      const outside = path.join(root, "outside");
      await mkdir(outside);
      await symlink(outside, path.join(workspace, "escape"));
      expect(nativePathAllowed(root, sessionId, path.join(workspace, "artifacts", "note.md"), "write")).toBe(true);
      expect(nativePathAllowed(root, sessionId, path.join(workspace, "escape", "secret.txt"), "write")).toBe(false);
      expect(nativePathAllowed(root, sessionId, path.join(root, "other-session", "report.md"), "read")).toBe(false);
      expect(nativePathAllowed(root, sessionId, path.join(root, ".pi", "SKILL.md"), "read")).toBe(true);
      expect(nativePathAllowed(root, sessionId, path.join(root, ".pi", "SKILL.md"), "write")).toBe(false);
      expect(piSessionDirectory(root, sessionId)).toBe(workspace);
      expect(bashCommandPathAllowed(root, sessionId, `sed -n '1p' data/sessions/${path.basename(workspace)}/reports/drafts/report.draft.md`)).toBe(true);
      expect(bashCommandPathAllowed(root, sessionId, "sed -n '1p' data/sessions/other-session/reports/report.md")).toBe(false);
      expect(bashCommandPathAllowed(root, sessionId, `sed -n '1p' data/sessions/${path.basename(workspace)}-other/reports/report.md`)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
