import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkspaceFiles } from "../src/server/workspaceService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workspace file listing", () => {
  it("hides implementation files from processed uploads", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "xunyi-workspace-"));
    temporaryDirectories.push(workspace);
    await mkdir(path.join(workspace, "artifacts", "uploads", "att-paper"), { recursive: true });
    await mkdir(path.join(workspace, "artifacts", "notes"), { recursive: true });
    await writeFile(path.join(workspace, "artifacts", "uploads", "att-paper", "full.md"), "# OCR");
    await writeFile(path.join(workspace, "artifacts", "uploads", "att-paper", "toc.md"), "# 目录");
    await writeFile(path.join(workspace, "artifacts", "notes", "plan.md"), "# 用户文件");

    const files = await listWorkspaceFiles(workspace);

    expect(files.map((file) => file.path)).toEqual(["artifacts/notes/plan.md"]);
  });
});
