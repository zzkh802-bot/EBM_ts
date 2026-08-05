import { readFile } from "node:fs/promises";
import path from "node:path";
import { archiveSource } from "../tools/archive.js";
import { parseDocumentBytes, type MineruParseResult } from "../tools/mineru.js";
import { loadProjectEnv } from "./projectEnv.js";
import type { StoredAttachment } from "./attachmentStore.js";

export async function archiveUploadedAttachments(rootDir: string, sessionDir: string, attachments: StoredAttachment[], signal?: AbortSignal): Promise<string> {
  if (!attachments.length) return "";
  const env = await loadProjectEnv(rootDir);
  const contexts: string[] = [];
  for (const attachment of attachments) {
    const bytes = new Uint8Array(await readFile(attachment.path));
    const parsed = await parseAttachment(env.MINERU_API_TOKEN, attachment, bytes, signal);
    const originalResource = { path: `original/${attachment.fileName}`, bytes, mediaType: attachment.mediaType };
    const resources = [originalResource, ...(parsed?.resources ?? [])];
    const archive = await archiveSource({
      sessionDir,
      kind: "upload",
      title: `用户附件：${attachment.fileName}`,
      archiveName: `${attachment.id}-${attachment.fileName}`,
      content: parsed?.content || `用户上传附件：${attachment.fileName}\n\n附件尚未完成文字解析。请根据原始文件或图像理解工具继续处理。`,
      resources,
    });
    const originalPath = archive.archiveDir ? path.posix.join(archive.archiveDir, originalResource.path) : archive.path;
    contexts.push([
      `用户附件：${attachment.fileName}`,
      `文字归档：${archive.path}`,
      `原始文件：${originalPath}`,
      ...(isImage(attachment.fileName) ? [`这是图像附件；如需视觉理解，请调用 medical_image_read，source_path=${originalPath}。`] : []),
      ...(parsed?.warning ? [`解析提示：${parsed.warning}`] : []),
    ].join("\n"));
  }
  return contexts.join("\n\n");
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

function isImage(fileName: string): boolean {
  return /\.(?:png|jpe?g|webp|gif)$/i.test(fileName);
}
