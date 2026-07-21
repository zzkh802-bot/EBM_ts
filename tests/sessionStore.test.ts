import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonSessionStore } from "../src/session/jsonSessionStore.js";

describe("JSON session store", () => {
  it("persists messages and compaction summaries in one json file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ebm-session-"));
    const store = new JsonSessionStore(root);
    const created = await store.create("user-1", "pico question");
    const withMessage = await store.appendMessage(created.id, { role: "user", content: "PICO" });
    const withCompaction = await store.addCompaction(created.id, "summary", withMessage.messages[0]!.id);

    expect(withCompaction.messages).toHaveLength(1);
    expect(withCompaction.compacted).toEqual([
      expect.objectContaining({ summary: "summary", throughMessageId: withMessage.messages[0]!.id }),
    ]);
    expect((await store.load(created.id)).messages[0]!.content).toBe("PICO");
  });
});
