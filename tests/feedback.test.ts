import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentStore, AttachmentStoreError } from "../src/server/attachmentStore.js";
import { FEEDBACK_RUBRICS, writeFeedback } from "../src/server/feedback.js";
import { writeQueryMetadata } from "../src/observability/queryMetadata.js";
import { initializePiSessionDirectory } from "../src/session/sessionPath.js";

describe("内测反馈与附件归档", () => {
  it("只接受 1-5 整数问卷并按行归档", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-feedback-"));
    const sessionId = "feedback-session";
    const sessionDir = await initializePiSessionDirectory(rootDir, sessionId, { firstPrompt: "测试问题" });
    const queryId = "12345678-1234-1234-1234-123456789012";
    await writeQueryMetadata(sessionDir, { schema_version: 1, query_id: queryId, run_id: queryId, session_id: sessionId, question: "测试问题", created_at: new Date().toISOString() });
    const rubrics = Object.fromEntries(FEEDBACK_RUBRICS.map((key, index) => [key, (index % 5) + 1]));
    const record = await writeFeedback(rootDir, sessionDir, "annotator", sessionId, {
      runId: queryId,
      queryId,
      rubrics,
      comment: "引用清晰",
    });
    const content = await readFile(path.join(sessionDir, record.path), "utf8");
    expect(JSON.parse(content)).toMatchObject({ rubrics, comment: "引用清晰" });
    await expect(writeFeedback(rootDir, sessionDir, "annotator", sessionId, {
      runId: queryId, queryId, rubrics: { requirement_understanding: 4.5 },
    })).rejects.toThrow("1 到 5 的整数");
    await expect(writeFeedback(rootDir, sessionDir, "annotator", sessionId, {
      runId: queryId, queryId, rubrics: { requirement_understanding: 4 },
    })).rejects.toThrow("完整填写全部 9 项");
    await expect(writeFeedback(rootDir, sessionDir, "annotator", sessionId, {
      runId: "87654321-4321-4321-4321-210987654321", queryId, rubrics,
    })).rejects.toThrow("run_id 与 query_id 不匹配");
  });

  it("附件按用户隔离并拒绝跨用户读取", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-attachment-"));
    const store = new AttachmentStore(rootDir);
    const attachment = await store.create("annotator-a", "病历.txt", "text/plain", new TextEncoder().encode("病历内容"));
    expect((await store.resolve("annotator-a", attachment.id)).fileName).toBe("病历.txt");
    await expect(store.resolve("annotator-b", attachment.id)).rejects.toBeInstanceOf(AttachmentStoreError);
  });

  it("拒绝跨研究会话读取已绑定的附件", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-attachment-session-"));
    const store = new AttachmentStore(rootDir);
    const attachment = await store.create("annotator-a", "病历.txt", "text/plain", new TextEncoder().encode("病历内容"), "session-a");
    await expect(store.resolve("annotator-a", attachment.id, "session-b")).rejects.toBeInstanceOf(AttachmentStoreError);
    await expect(store.resolve("annotator-a", attachment.id, "session-a")).resolves.toMatchObject({ id: attachment.id });
  });
});
