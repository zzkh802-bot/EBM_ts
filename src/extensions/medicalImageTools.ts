import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { piSessionDirectory } from "./sessionPath.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_BASE_URL = "https://cloud.infini-ai.com/maas/v1";
const DEFAULT_MODEL = "kimi-k2.5";

/** Auxiliary visual interpretation for uploaded medical images; never a diagnosis. */
export function registerMedicalImageTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  pi.registerTool({
    name: "medical_image_read",
    label: "理解医学图像",
    description: "按需调用独立视觉模型理解用户上传的医学图像。主 Agent 只能看到附件 ID 和处理后的文字 Markdown；本工具在后端读取原图，将 Kimi K2.5 的中文辅助描述归档供主 Agent 参考。结果不替代影像科或临床诊断。",
    parameters: Type.Object({
      attachment_id: Type.Optional(Type.String({ description: "用户上传医学图像的附件 ID" })),
      source_path: Type.Optional(Type.String({ description: "旧版会话图像路径；新附件请使用 attachment_id" })),
      question: Type.Optional(Type.String({ description: "希望视觉模型重点观察的问题" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const imagePath = params.attachment_id
        ? await resolveAttachmentImage(ctx.cwd, params.attachment_id)
        : params.source_path ? await resolveImagePath(sessionDir, params.source_path) : (() => { throw new Error("请提供 attachment_id。 "); })();
      const imageStat = await stat(imagePath);
      if (imageStat.size <= 0 || imageStat.size > MAX_IMAGE_BYTES) throw new Error("医学图像为空或超过 10 MB 限制。");
      const mediaType = imageMediaType(imagePath);
      if (!mediaType) throw new Error("医学图像仅支持 PNG、JPEG、WebP 或 GIF。");
      const bytes = new Uint8Array(await readFile(imagePath));
      const question = params.question?.trim().slice(0, 2_000) || "请用中文描述这张医学图像中可观察到的内容，并明确说明无法可靠判断的部分。";
      const apiKey = process.env.XINQIONG_API_KEY?.trim();
      if (!apiKey) throw new Error("医学图像理解服务未配置 XINQIONG_API_KEY。");
      const baseUrl = (process.env.XINQIONG_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(new Error("医学图像服务请求超时")), 120_000);
      try {
        const requestSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.XINQIONG_VISION_MODEL?.trim() || DEFAULT_MODEL,
            messages: [{ role: "user", content: [
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` } },
              { type: "text", text: question },
            ] }],
            temperature: 0.2,
            stream: false,
          }),
          signal: requestSignal,
        });
        const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: unknown } };
        if (!response.ok) throw new Error(`医学图像服务 HTTP ${response.status}：${typeof payload.error?.message === "string" ? payload.error.message : "请求失败"}`);
        const content = extractText(payload.choices?.[0]?.message?.content);
        if (!content) throw new Error("医学图像服务未返回可读结果。");
        const analysis = [
          "# 医学图像辅助理解",
          "",
          `- 图像附件：${params.attachment_id || path.basename(imagePath)}`,
          `- 提问：${question}`,
          "- 性质：视觉模型辅助描述，不构成诊断、分级或治疗建议。",
          "",
          content.slice(0, 12_000),
        ].join("\n");
        const archivePath = path.posix.join("artifacts", "uploads", `${params.attachment_id || createHash("sha256").update(imagePath).digest("hex").slice(0, 16)}-visual.md`);
        await mkdir(path.join(sessionDir, "artifacts", "uploads"), { recursive: true });
        await writeFile(path.join(sessionDir, ...archivePath.split("/")), `${analysis}\n`, { encoding: "utf8", mode: 0o600 });
        return {
          content: [{ type: "text", text: `已完成医学图像辅助理解（仅供研究参考，不替代诊断）。\n归档：${archivePath}\n\n${content.slice(0, 12_000)}` }],
          details: { archive_path: archivePath, attachment_id: params.attachment_id },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

async function resolveAttachmentImage(rootDir: string, attachmentId: string): Promise<string> {
  if (!/^att_[a-f0-9]{24}$/.test(attachmentId)) throw new Error("附件 ID 无效。 ");
  const root = path.join(rootDir, "data", "attachments");
  let owners;
  try { owners = await readdir(root, { withFileTypes: true }); } catch { throw new Error("未找到该医学图像附件。 "); }
  for (const owner of owners.filter((entry) => entry.isDirectory())) {
    const metadataPath = path.join(root, owner.name, attachmentId, "metadata.json");
    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { id?: string; path?: string; fileName?: string };
      if (metadata.id !== attachmentId || typeof metadata.path !== "string" || !/\.(?:png|jpe?g|webp|gif)$/i.test(metadata.fileName || metadata.path)) continue;
      return metadata.path;
    } catch {
      // Continue searching the hashed user directories.
    }
  }
  throw new Error("未找到该医学图像附件。 ");
}

async function resolveImagePath(sessionDir: string, sourcePath: string): Promise<string> {
  const normalized = sourcePath.replace(/^@/, "").replaceAll("\\", "/");
  const sessionName = path.basename(sessionDir);
  const relative = normalized.startsWith(`data/sessions/${sessionName}/`)
    ? normalized.slice(`data/sessions/${sessionName}/`.length)
    : normalized;
  const candidate = path.resolve(sessionDir, relative);
  const root = await realpath(sessionDir);
  const resolved = await realpath(candidate);
  const boundary = path.relative(root, resolved);
  if (boundary.startsWith("..") || path.isAbsolute(boundary)) throw new Error("医学图像路径必须位于当前研究会话内。");
  return resolved;
}

function imageMediaType(filePath: string): string | undefined {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[path.extname(filePath).toLowerCase()];
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map((part) => part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("").trim();
}
