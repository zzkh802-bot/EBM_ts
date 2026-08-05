import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentStore, AttachmentStoreError } from "../src/server/attachmentStore.js";
import { writeFeedback } from "../src/server/feedback.js";
import { writeQueryMetadata } from "../src/observability/queryMetadata.js";
import { initializePiSessionDirectory } from "../src/session/sessionPath.js";

describe("内测反馈与附件归档", () => {
  it("只接受 1-5 整数问卷并按行归档", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-feedback-"));
    const sessionId = "feedback-session";
    const sessionDir = await initializePiSessionDirectory(rootDir, sessionId, { firstPrompt: "测试问题" });
    const queryId = "12345678-1234-1234-1234-123456789012";
    await writeQueryMetadata(sessionDir, { schema_version: 1, query_id: queryId, session_id: sessionId, question: "测试问题", created_at: new Date().toISOString() });
    const record = await writeFeedback(rootDir, sessionDir, "annotator", sessionId, {
      runId: queryId,
      queryId,
      rubrics: { requirement_understanding: 5, evidence_support: 4, time_worth: 3 },
      preferredTool: "doubao",
      comment: "引用清晰",
    });
    const content = await readFile(path.join(sessionDir, record.path), "utf8");
    expect(JSON.parse(content)).toMatchObject({ rubrics: { requirement_understanding: 5, evidence_support: 4, time_worth: 3 }, preferred_tool: "doubao", comment: "引用清晰" });
    await expect(writeFeedback(rootDir, sessionDir, "annotator", sessionId, {
      runId: queryId, queryId, rubrics: { requirement_understanding: 4.5 },
    })).rejects.toThrow("1 到 5 的整数");
  });

  it("附件按用户隔离并拒绝跨用户读取", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-attachment-"));
    const store = new AttachmentStore(rootDir);
    const attachment = await store.create("annotator-a", "病历.txt", "text/plain", new TextEncoder().encode("病历内容"));
    expect((await store.resolve("annotator-a", attachment.id)).fileName).toBe("病历.txt");
    await expect(store.resolve("annotator-b", attachment.id)).rejects.toBeInstanceOf(AttachmentStoreError);
  });
});
