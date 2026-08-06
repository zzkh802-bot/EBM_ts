import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerTrajectoryRecorder } from "../src/extensions/trajectoryRecorder.js";
import { existingPiSessionDirectory, initializePiSessionDirectory, piReadableSessionPath, piSessionCreatedDate, piSessionDirectory, registerSessionWorkspace } from "../src/extensions/sessionPath.js";

describe("semantic session workspaces", () => {
  it("initializes the semantic workspace before the trajectory recorder writes its first artifact", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "019f892b-749e-72e7-949f-aadc2cd8b509";
    const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
    const pi = { on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    } };
    registerSessionWorkspace(pi as never);
    registerTrajectoryRecorder(pi as never);
    const ctx = {
      cwd,
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionName: () => "卒中溶栓",
        getSessionFile: () => "session.jsonl",
      },
      getContextUsage: () => undefined,
    };
    for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start", reason: "startup" }, ctx);
    expect(existsSync(path.join(cwd, "data", "sessions", sessionId))).toBe(false);
    for (const handler of handlers.get("before_agent_start") ?? []) await handler({
      type: "before_agent_start",
      prompt: "患者是否适合rt-PA？",
      systemPrompt: "system",
      systemPromptOptions: { selectedTools: [], skills: [] },
    }, ctx);
    const workspace = piSessionDirectory(cwd, sessionId);
    expect(path.basename(workspace)).toBe("019f892b_卒中溶栓");
    await expect(readFile(path.join(workspace, "trace", "trajectory.jsonl"), "utf8")).resolves.toContain('"event":"session_start"');
  });

  it("creates a stable Unicode workspace from an explicit Pi session name", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "019f892b-749e-72e7-949f-aadc2cd8b509";

    const workspace = await initializePiSessionDirectory(cwd, sessionId, {
      sessionName: "急性卒中 rt-PA 与血压管理",
      firstPrompt: "ignored when an explicit name exists",
    });

    expect(path.basename(workspace)).toBe("019f892b_急性卒中-rt-pa-与血压管理");
    expect(piSessionDirectory(cwd, sessionId)).toBe(workspace);
    expect(existingPiSessionDirectory(cwd, sessionId)).toBe(workspace);
    expect(piReadableSessionPath(cwd, sessionId, "sources/read/trial/full.md")).toBe("data/sessions/019f892b_急性卒中-rt-pa-与血压管理/sources/read/trial/full.md");
    await expect(readFile(path.join(workspace, ".metadata", "session.json"), "utf8")).resolves.toContain(`"sessionId": "${sessionId}"`);
  });

  it("reports session created date in Beijing time", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "beijing-date-session";
    const workspace = await initializePiSessionDirectory(cwd, sessionId, { firstPrompt: "Date boundary" });
    await writeFile(path.join(workspace, ".metadata", "session.json"), JSON.stringify({ sessionId, createdAt: "2026-01-01T16:30:00.000Z" }), "utf8");
    expect(piSessionCreatedDate(cwd, sessionId)).toBe("2026-01-02");
  });

  it("keeps workspaces distinct when short ids and semantic names collide", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const first = await initializePiSessionDirectory(cwd, "abcdef12-0000-0000-0000-000000000001", { firstPrompt: "AML consolidation" });
    const second = await initializePiSessionDirectory(cwd, "abcdef12-0000-0000-0000-000000000002", { firstPrompt: "AML consolidation" });
    expect(second).not.toBe(first);
    await expect(readFile(path.join(first, ".metadata", "session.json"), "utf8")).resolves.toContain("000000000001");
    await expect(readFile(path.join(second, ".metadata", "session.json"), "utf8")).resolves.toContain("000000000002");
  });

  it("converges concurrent initialization of the same Pi session", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "concurrent-session-1";
    const [first, second] = await Promise.all([
      initializePiSessionDirectory(cwd, sessionId, { firstPrompt: "Concurrent trial" }),
      initializePiSessionDirectory(cwd, sessionId, { firstPrompt: "Concurrent trial" }),
    ]);
    expect(second).toBe(first);
    expect(piSessionDirectory(cwd, sessionId)).toBe(first);
  });

  it("keeps a pre-created UUID workspace addressable through the canonical session mapping", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "legacy-session-1";
    const legacy = path.join(cwd, "data", "sessions", sessionId);
    await mkdir(legacy, { recursive: true });
    await expect(initializePiSessionDirectory(cwd, sessionId, { firstPrompt: "New semantic title" })).resolves.toBe(legacy);
    expect(piReadableSessionPath(cwd, sessionId, "reports/report.md")).toBe("data/sessions/legacy-session-1/reports/report.md");
    await expect(readFile(path.join(cwd, "data", "sessions", ".metadata", "workspaces", `${sessionId}.json`), "utf8"))
      .resolves.toContain(`"directory": "${sessionId}"`);
    await expect(readFile(path.join(legacy, ".metadata", "session.json"), "utf8"))
      .resolves.toContain(`"sessionId": "${sessionId}"`);
  });

  it("rejects symlinked legacy workspaces", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "legacy-symlink-1";
    const outside = await mkdtemp(path.join(os.tmpdir(), "ebm-outside-"));
    await mkdir(path.join(cwd, "data", "sessions"), { recursive: true });
    await symlink(outside, path.join(cwd, "data", "sessions", sessionId), "dir");
    await expect(initializePiSessionDirectory(cwd, sessionId, { firstPrompt: "Unsafe" })).rejects.toThrow(/unsafe legacy workspace/);
  });

  it("ignores symlinked mapped workspaces", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "mapped-symlink-1";
    const outside = await mkdtemp(path.join(os.tmpdir(), "ebm-outside-"));
    const root = path.join(cwd, "data", "sessions");
    await mkdir(path.join(root, ".metadata", "workspaces"), { recursive: true });
    await mkdir(path.join(outside, ".metadata"), { recursive: true });
    await writeFile(path.join(outside, ".metadata", "session.json"), JSON.stringify({ sessionId }));
    await symlink(outside, path.join(root, "mapped"), "dir");
    await writeFile(path.join(root, ".metadata", "workspaces", `${sessionId}.json`), JSON.stringify({ sessionId, directory: "mapped" }));
    expect(piSessionDirectory(cwd, sessionId)).toBe(path.join(root, sessionId));
    expect(existingPiSessionDirectory(cwd, sessionId)).toBeUndefined();
  });

  it("rejects traversal in model-readable session paths", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    await initializePiSessionDirectory(cwd, "safe-session-1", { firstPrompt: "Safe study" });
    expect(() => piReadableSessionPath(cwd, "safe-session-1", "../other/source.md")).toThrow(/invalid session-relative path/);
  });

  it("derives a bounded semantic name from the first prompt when the session is unnamed", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-workspace-"));
    const sessionId = "abcdef12-749e-72e7-949f-aadc2cd8b509";
    const workspace = await initializePiSessionDirectory(cwd, sessionId, {
      firstPrompt: "成人 AML CR1：HDAC 单药与多药联合巩固，哪种更合适？",
    });
    expect(path.basename(workspace)).toBe("abcdef12_成人-aml-cr1-hdac-单药与多药联合巩固-哪种更合适");
  });
});
