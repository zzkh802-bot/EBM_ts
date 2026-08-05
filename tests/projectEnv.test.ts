import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectEnv } from "../src/server/projectEnv.js";
import { allowlistedPiEnvironment } from "../src/server/piRuntime.js";

describe("project environment loading", () => {
  it("passes only shared tool settings and the selected provider secret to Pi", () => {
    expect(allowlistedPiEnvironment({ DEEPSEEK_API_KEY: "deepseek", OPENAI_API_KEY: "openai", EBM_INTERNAL_ACCESS_KEY: "shared", NCBI_EMAIL: "a@example.com" }, "deepseek"))
      .toEqual({ DEEPSEEK_API_KEY: "deepseek", NCBI_EMAIL: "a@example.com" });
  });

  it("parses simple and quoted values without leaking unrelated lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ebm-project-env-"));
    try {
      await writeFile(path.join(root, ".env"), "MODEL=deepseek\nQUOTED=\"two words\"\n# ignored\nnot-an-assignment\n", "utf8");
      await expect(loadProjectEnv(root)).resolves.toEqual({ MODEL: "deepseek", QUOTED: "two words" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns an empty object when the project has no env file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ebm-project-env-"));
    try {
      await expect(loadProjectEnv(root)).resolves.toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
