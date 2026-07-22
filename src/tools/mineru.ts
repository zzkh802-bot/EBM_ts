import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { validateOutboundUrl } from "./urlSafety.js";

export type MineruResource = { path: string; bytes: Uint8Array; mediaType: string };

export type MineruParseResult = {
  parser: "mineru-premium-url" | "mineru-premium-upload";
  content: string;
  resources: MineruResource[];
  taskId: string;
};

type MineruEnvelope = {
  code?: unknown;
  msg?: unknown;
  data?: Record<string, unknown>;
};

async function request(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`MinerU request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const response = await fetcher(url, { ...init, signal: requestSignal });
    if (!response.ok) {
      const body = (await response.text()).trim().slice(0, 500);
      throw new Error(`MinerU HTTP ${response.status}: ${body || response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function envelope(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json() as MineruEnvelope;
  if (!payload.data || typeof payload.data !== "object") {
    throw new Error(`MinerU response has no data${typeof payload.msg === "string" ? `: ${payload.msg}` : ""}`);
  }
  return payload.data;
}

function imageMediaType(name: string): string | undefined {
  const extension = path.posix.extname(name).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" } as Record<string, string>)[extension];
}

function referencedMineruResources(markdown: string, markdownName: string, files: Record<string, Uint8Array>): MineruResource[] {
  const references = new Set<string>();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))/g)) references.add(match[1] ?? match[2] ?? "");
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) references.add(match[1] ?? "");
  const markdownDir = path.posix.dirname(markdownName.replaceAll("\\", "/"));
  const resources: MineruResource[] = [];
  let totalBytes = 0;
  for (const rawReference of references) {
    if (!rawReference || /^(?:https?:|data:|#)/i.test(rawReference)) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawReference.split(/[?#]/, 1)[0]!);
    } catch {
      continue;
    }
    const zipPath = path.posix.normalize(path.posix.join(markdownDir, decoded));
    const relative = path.posix.relative(markdownDir, zipPath);
    if (!relative || relative.startsWith("../") || path.posix.isAbsolute(relative)) continue;
    const mediaType = imageMediaType(relative);
    const bytes = files[zipPath];
    if (!mediaType || !bytes || bytes.byteLength > 10 * 1024 * 1024) continue;
    if (resources.length >= 200 || totalBytes + bytes.byteLength > 50 * 1024 * 1024) break;
    resources.push({ path: relative, bytes, mediaType });
    totalBytes += bytes.byteLength;
  }
  return resources;
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function validateServiceReturnedUrl(rawUrl: string, label: string): string {
  const safe = validateOutboundUrl(rawUrl);
  if (!safe.ok) throw new Error(`unsafe MinerU ${label} URL: ${safe.reason}`);
  if (safe.url.protocol !== "https:") throw new Error(`unsafe MinerU ${label} URL: HTTPS is required`);
  return safe.url.toString();
}

async function extractMarkdownZip(fetcher: typeof fetch, zipUrl: string, requestTimeoutMs: number, signal?: AbortSignal): Promise<{ content: string; resources: MineruResource[] }> {
  const zipResponse = await request(fetcher, validateServiceReturnedUrl(zipUrl, "result ZIP"), { method: "GET" }, Math.max(requestTimeoutMs, 60_000), signal);
  const maxZipBytes = 100 * 1024 * 1024;
  const declaredLength = Number(zipResponse.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxZipBytes) throw new Error(`MinerU result ZIP exceeds ${maxZipBytes} byte limit`);
  const zipBytes = new Uint8Array(await zipResponse.arrayBuffer());
  if (zipBytes.byteLength > maxZipBytes) throw new Error(`MinerU result ZIP exceeds ${maxZipBytes} byte limit`);
  let selectedImages = 0;
  let selectedImageBytes = 0;
  let selectedMarkdownBytes = 0;
  const files = unzipSync(zipBytes, { filter: (file) => {
    const markdown = file.name.endsWith(".md") && file.originalSize <= 50 * 1024 * 1024;
    const image = Boolean(imageMediaType(file.name)) && file.originalSize <= 10 * 1024 * 1024;
    if (!markdown && !image) return false;
    if (markdown) {
      if (selectedMarkdownBytes + file.originalSize > 50 * 1024 * 1024) return false;
      selectedMarkdownBytes += file.originalSize;
      return true;
    }
    if (selectedImages >= 200 || selectedImageBytes + file.originalSize > 50 * 1024 * 1024) return false;
    selectedImages += 1;
    selectedImageBytes += file.originalSize;
    return true;
  } });
  const names = Object.keys(files);
  const markdownName = names.find((name) => name.endsWith("full.md")) ?? names.find((name) => name.endsWith(".md"));
  if (!markdownName) throw new Error("MinerU result ZIP does not contain Markdown");
  const content = strFromU8(files[markdownName]!);
  if (!content.trim()) throw new Error("MinerU returned empty Markdown");
  return { content, resources: referencedMineruResources(content, markdownName, files) };
}

export async function parseDocumentUrl(input: {
  url: string;
  apiToken: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
  modelVersion?: string;
  language?: string;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<MineruParseResult> {
  const safe = validateOutboundUrl(input.url);
  if (!safe.ok) throw new Error(safe.reason);
  if (!input.apiToken.trim()) throw new Error("MINERU_API_TOKEN is not configured");
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.baseUrl ?? "https://mineru.net/api/v4").replace(/\/$/, "");
  const requestTimeoutMs = input.requestTimeoutMs ?? 20_000;
  const headers = { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" };
  const created = await envelope(await request(fetcher, `${baseUrl}/extract/task`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: safe.url.toString(),
      model_version: input.modelVersion ?? "vlm",
      language: input.language ?? "en",
    }),
  }, requestTimeoutMs, input.signal));
  const taskId = created.task_id;
  if (typeof taskId !== "string" || !taskId) throw new Error("MinerU response has no task_id");

  const deadline = Date.now() + (input.pollTimeoutMs ?? 180_000);
  let zipUrl: string | undefined;
  while (Date.now() <= deadline) {
    const task = await envelope(await request(fetcher, `${baseUrl}/extract/task/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers,
    }, requestTimeoutMs, input.signal));
    if (task.state === "failed") throw new Error(typeof task.err_msg === "string" ? task.err_msg : "MinerU parsing failed");
    if (task.state === "done") {
      if (typeof task.full_zip_url !== "string" || !task.full_zip_url) throw new Error("MinerU result has no full_zip_url");
      zipUrl = task.full_zip_url;
      break;
    }
    await abortableDelay(input.pollIntervalMs ?? 3_000, input.signal);
  }
  if (!zipUrl) throw new Error(`MinerU parse timed out after ${input.pollTimeoutMs ?? 180_000}ms`);

  const extracted = await extractMarkdownZip(fetcher, zipUrl, requestTimeoutMs, input.signal);
  return { parser: "mineru-premium-url", ...extracted, taskId };
}

export async function parseDocumentBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  apiToken: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
  modelVersion?: string;
  language?: string;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<MineruParseResult> {
  if (!input.bytes.byteLength) throw new Error("cannot upload an empty document to MinerU");
  if (!/^[^/\\]+\.(?:pdf|docx?|pptx?|png|jpe?g)$/i.test(input.fileName)) throw new Error("MinerU upload requires a safe supported filename");
  if (!input.apiToken.trim()) throw new Error("MINERU_API_TOKEN is not configured");
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.baseUrl ?? "https://mineru.net/api/v4").replace(/\/$/, "");
  const requestTimeoutMs = input.requestTimeoutMs ?? 20_000;
  const headers = { Authorization: `Bearer ${input.apiToken}`, "Content-Type": "application/json" };
  const created = await envelope(await request(fetcher, `${baseUrl}/file-urls/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      files: [{ name: input.fileName }],
      model_version: input.modelVersion ?? "vlm",
      language: input.language ?? "en",
    }),
  }, requestTimeoutMs, input.signal));
  const taskId = created.batch_id;  const uploadUrl = Array.isArray(created.file_urls) ? created.file_urls[0] : undefined;
  if (typeof taskId !== "string" || !taskId) throw new Error("MinerU upload response has no batch_id");
  if (typeof uploadUrl !== "string" || !uploadUrl) throw new Error("MinerU upload response has no signed file URL");
  const uploadBody = new Uint8Array(input.bytes).buffer;
  await request(fetcher, validateServiceReturnedUrl(uploadUrl, "upload"), { method: "PUT", body: uploadBody }, Math.max(requestTimeoutMs, 60_000), input.signal);

  const deadline = Date.now() + (input.pollTimeoutMs ?? 180_000);
  let zipUrl: string | undefined;
  while (Date.now() <= deadline) {
    const batch = await envelope(await request(fetcher, `${baseUrl}/extract-results/batch/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers,
    }, requestTimeoutMs, input.signal));
    const result = Array.isArray(batch.extract_result) ? batch.extract_result[0] as Record<string, unknown> | undefined : undefined;
    if (result?.state === "failed") throw new Error(typeof result.err_msg === "string" ? result.err_msg : "MinerU parsing failed");
    if (result?.state === "done") {
      if (typeof result.full_zip_url !== "string" || !result.full_zip_url) throw new Error("MinerU result has no full_zip_url");
      zipUrl = result.full_zip_url;
      break;
    }
    await abortableDelay(input.pollIntervalMs ?? 3_000, input.signal);
  }
  if (!zipUrl) throw new Error(`MinerU parse timed out after ${input.pollTimeoutMs ?? 180_000}ms`);
  const extracted = await extractMarkdownZip(fetcher, zipUrl, requestTimeoutMs, input.signal);
  return { parser: "mineru-premium-upload", ...extracted, taskId };
}
