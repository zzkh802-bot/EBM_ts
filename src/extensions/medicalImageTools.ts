import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { archiveSource } from "../tools/archive.js";
import { piSessionDirectory } from "./sessionPath.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_BASE_URL = "https://cloud.infini-ai.com/maas/v1";
const DEFAULT_MODEL = "kimi-k2.5";

/** Auxiliary visual interpretation for uploaded medical images; never a diagnosis. */
export function registerMedicalImageTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  pi.registerTool({
    name: "medical_image_read",
    label: "理解医学图像",
    description: "调用独立视觉模型理解当前研究会话中的医学图像，并将结果归档供主 Agent 参考。结果仅为辅助描述，不替代影像科或临床诊断。",
    parameters: Type.Object({
      source_path: Type.String({ description: "当前研究会话归档中的图像路径" }),
      question: Type.Optional(Type.String({ description: "希望视觉模型重点观察的问题" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
      const imagePath = await resolveImagePath(sessionDir, params.source_path);
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
          `- 图像：${path.posix.relative(sessionDir, imagePath).replaceAll("\\", "/")}`,
          `- 提问：${question}`,
          "- 性质：视觉模型辅助描述，不构成诊断、分级或治疗建议。",
          "",
          content.slice(0, 12_000),
        ].join("\n");
        const archive = await archiveSource({
          sessionDir,
          kind: "upload",
          layout: "file",
          title: `医学图像辅助理解：${path.basename(imagePath)}`,
          archiveName: `medical-image-analysis-${createHash("sha256").update(imagePath).digest("hex").slice(0, 16)}`,
          content: analysis,
        });
        return {
          content: [{ type: "text", text: `已完成医学图像辅助理解（仅供研究参考，不替代诊断）。\n归档：${archive.path}\n\n${content.slice(0, 12_000)}` }],
          details: { archive_path: archive.path, source_path: path.posix.relative(sessionDir, imagePath).replaceAll("\\", "/") },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
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
