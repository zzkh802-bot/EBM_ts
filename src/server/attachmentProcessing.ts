import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocumentBytes, type MineruParseResult } from "../tools/mineru.js";
import { preprocessExternalContent } from "../tools/markdown.js";
import { loadProjectEnv } from "./projectEnv.js";
import { AttachmentStore, type StoredAttachment } from "./attachmentStore.js";

/** Shared compact preview budget: 3,500 Unicode characters. */
export const ATTACHMENT_INLINE_LIMIT_CHARS = 3_500;

type AttachmentProgress = (text: string) => void;

export async function archiveUploadedAttachments(
  rootDir: string,
  sessionDir: string,
  sessionId: string,
  attachments: StoredAttachment[],
  signal?: AbortSignal,
  onProgress?: AttachmentProgress,
): Promise<string> {
  if (!attachments.length) return "";
  const env = await loadProjectEnv(rootDir);
  onProgress?.(`正在并行解析 ${attachments.length} 个附件（OCR/文字提取）…`);
  const results = await Promise.all(attachments.map(async (attachment, index) => {
    if (signal?.aborted) throw signal.reason;
    onProgress?.(`正在解析附件 ${index + 1}/${attachments.length}：${attachment.fileName}`);
    const bytes = new Uint8Array(await readFile(attachment.path));
    const parsed = await parseAttachment(env.MINERU_API_TOKEN, attachment, bytes, signal);
    const content = normalizeAttachmentContent(attachment, parsed);
    const processedPath = await writeProcessedAttachment(sessionDir, attachment, content);
    const readableProcessedPath = readableSessionFilePath(sessionDir, processedPath);
    // `sessionDir` is a semantic workspace path (it may include a user prefix),
    // while attachment listings are keyed by the public API session id.
    await new AttachmentStore(rootDir).markProcessed(attachment, sessionId, processedPath);
    onProgress?.(`附件 ${index + 1}/${attachments.length} 已完成文字解析：${attachment.fileName}`);
    const inline = Array.from(content).length <= ATTACHMENT_INLINE_LIMIT_CHARS;
    const preview = inline
      ? content
      : `${previewContent(content)}\n[预览已截断；完整处理后文件请使用 read 读取：${readableProcessedPath}]`;
    const imageAttachment = isImageAttachment(attachment.fileName);
    const fileBlock = imageAttachment
      ? `<medical_image name="${escapeAttribute(attachment.fileName)}" attachment_id="${attachment.id}">\n${preview}\n</medical_image>`
      : `<file name="${escapeAttribute(attachment.fileName)}">\n${preview}\n</file>`;
    return [
      fileBlock,
      ...(imageAttachment ? [`如需视觉辅助理解，请调用 medical_image_read(attachment_id="${attachment.id}")；原始图像不会直接提供给主 Agent。`] : []),
      `处理后文件（请使用 read 读取）：${readableProcessedPath}`,
      ...(parsed?.warning ? [`解析提示：${parsed.warning}`] : []),
    ].join("\n");
  }));
  onProgress?.(`已完成 ${attachments.length} 个附件的文字解析，正在交给研究引擎。`);
  return results.join("\n\n");
}

function readableSessionFilePath(sessionDir: string, relativePath: string): string {
  return path.posix.join("data", "sessions", path.basename(sessionDir), relativePath);
}

async function parseAttachment(apiToken: string | undefined, attachment: StoredAttachment, bytes: Uint8Array, signal?: AbortSignal): Promise<(MineruParseResult & { warning?: string }) | undefined> {
  if (/\.(?:txt|md)$/i.test(attachment.fileName)) return { parser: "mineru-premium-upload", content: new TextDecoder().decode(bytes), resources: [], taskId: "text-upload" };
  if (!apiToken) return { parser: "mineru-premium-upload", content: "", resources: [], taskId: "mineru-not-configured", warning: "MINERU_API_TOKEN 未配置，暂未提取附件文字。" };
  try {
    return await parseDocumentBytes({ bytes, fileName: attachment.fileName, apiToken, language: "ch", ...(signal ? { signal } : {}) });
  } catch (error) {
    return { parser: "mineru-premium-upload", content: "", resources: [], taskId: "mineru-failed", warning: error instanceof Error ? error.message.slice(0, 300) : "MinerU 解析失败。" };
  }
}

function normalizeAttachmentContent(attachment: StoredAttachment, parsed?: MineruParseResult & { warning?: string }): string {
  const raw = parsed?.content?.trim() || `附件“${attachment.fileName}”未提取出可读文字。`;
  return preprocessExternalContent(raw, { format: "markdown" }).trim();
}

async function writeProcessedAttachment(sessionDir: string, attachment: StoredAttachment, content: string): Promise<string> {
  const root = path.join(sessionDir, "artifacts", "uploads");
  await mkdir(root, { recursive: true });
  const stem = `${attachment.id}-${attachment.fileName.replace(/[^\p{L}\p{N}._-]+/gu, "-")}`;
  if (Array.from(content).length <= ATTACHMENT_INLINE_LIMIT_CHARS) {
    const relative = path.posix.join("artifacts", "uploads", `${stem}.md`);
    await writeFile(path.join(sessionDir, ...relative.split("/")), `${content}\n`, { encoding: "utf8", flag: "w", mode: 0o600 });
    return relative;
  }
  const directory = path.join(root, stem);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const full = path.posix.join("artifacts", "uploads", stem, "full.md");
  const toc = path.posix.join("artifacts", "uploads", stem, "toc.md");
  await writeFile(path.join(directory, "full.md"), `${content}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(path.join(directory, "toc.md"), renderToc(full, content), { encoding: "utf8", mode: 0o600 });
  return full;
}

function renderToc(fullPath: string, content: string): string {
  const lines = content.split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = /^\s*(#{1,6})\s+(.+)$/.exec(line);
    return match ? [`- ${match[1]!.length}级：${match[2]!.trim()} — 第 ${index + 1} 行`] : [];
  });
  return [`# 附件文字索引`, ``, `- 文件：\`${fullPath}\``, `- 总行数：${lines.length}`, ``, `## 章节`, ``, ...(headings.length ? headings : [`- 未检测到 Markdown 标题。`]), ``].join("\n");
}

function escapeAttribute(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function isImageAttachment(fileName: string): boolean { return /\.(?:png|jpe?g|webp|gif)$/i.test(fileName); }

function previewContent(content: string): string {
  return Array.from(content).slice(0, ATTACHMENT_INLINE_LIMIT_CHARS).join("");
}
