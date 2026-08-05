import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveUploadedAttachments } from "../src/server/attachmentProcessing.js";
import { AttachmentStore } from "../src/server/attachmentStore.js";
import { buildAgentPrompt } from "../src/server/agentApi.js";

describe("uploaded attachment processing", () => {
  it("parses text attachments in parallel, archives a user-visible Markdown file, and hides originals from the model context", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-upload-processing-"));
    const sessionDir = path.join(rootDir, "data", "pi-sessions", "session-a");
    const store = new AttachmentStore(rootDir);
    const [first, second] = await Promise.all([
      store.create("user-a", "病历一.txt", "text/plain", new TextEncoder().encode("第一份附件内容")),
      store.create("user-a", "病历二.md", "text/markdown", new TextEncoder().encode("第二份附件内容")),
    ]);
    const progress: string[] = [];
    const context = await archiveUploadedAttachments(rootDir, sessionDir, [first, second], undefined, (text) => progress.push(text));
    expect(context).toContain('<file name="病历一.txt">');
    expect(context).toContain("第一份附件内容");
    expect(context).toContain("<file name=\"病历二.md\">");
    expect(context).not.toContain("original/");
    expect(progress.some((text) => text.includes("并行解析 2 个附件"))).toBe(true);
    expect(progress.some((text) => text.includes("已完成 2 个附件"))).toBe(true);
    await expect(stat(path.join(sessionDir, "artifacts", "uploads"))).resolves.toBeTruthy();
    const updated = await store.resolve("user-a", first.id);
    expect(updated.clientSessionId).toBe("session-a");
    expect(updated.processedPath).toMatch(/^artifacts\/uploads\//);
  });

  it("wraps image attachments in a medical_image block and exposes only the attachment id", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-upload-image-"));
    const sessionDir = path.join(rootDir, "data", "pi-sessions", "session-image");
    const store = new AttachmentStore(rootDir);
    const attachment = await store.create("user-image", "scan.png", "image/png", new Uint8Array([137, 80, 78, 71]));
    const context = await archiveUploadedAttachments(rootDir, sessionDir, [attachment]);

    expect(context).toContain(`<medical_image name="scan.png" attachment_id="${attachment.id}">`);
    expect(context).toContain("</medical_image>");
    expect(context).toContain(`medical_image_read(attachment_id="${attachment.id}")`);
    expect(context).not.toContain("data/attachments");
    expect(context).not.toContain("<file name=\"scan.png\">");
  });

  it("switches to a read-first archive for content above the shared 3500-character preview limit", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-upload-long-"));
    const sessionDir = path.join(rootDir, "data", "pi-sessions", "session-b");
    const store = new AttachmentStore(rootDir);
    const attachment = await store.create("user-b", "long.txt", "text/plain", new TextEncoder().encode("长文本。".repeat(4_000)));
    const context = await archiveUploadedAttachments(rootDir, sessionDir, [attachment]);
    expect(context).toContain("请使用 read 读取");
    expect(context).toContain("长文本");
    expect(context).toContain("预览已截断");
    const files = await readFile(path.join(sessionDir, "artifacts", "uploads", `${attachment.id}-long.txt`, "full.md"), "utf8");
    expect(files).toContain("长文本");
    await expect(stat(path.join(sessionDir, "artifacts", "uploads", `${attachment.id}-long.txt`, "toc.md"))).resolves.toBeTruthy();
  });

  it("places inline file material after the user's question", () => {
    const prompt = buildAgentPrompt({
      question: "请整理这个附件", audienceMode: "clinician", thinkingLevel: "low", searchEnabled: true,
      retrievalPolicy: "all", responseMode: "answer", maxIterations: 8, requestTimeoutSeconds: 60,
      provider: "deepseek", model: "deepseek-v4-flash",
    }, '<file name="note.txt">附件正文</file>');
    expect(prompt.indexOf("请整理这个附件")).toBeLessThan(prompt.indexOf("<file name=\"note.txt\">"));
  });
});
