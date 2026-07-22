import { strFromU8, unzipSync } from "fflate";
import { validateOutboundUrl } from "./urlSafety.js";

export type MineruParseResult = {
  parser: "mineru-premium-url";
  content: string;
  taskId: string;
};

type MineruEnvelope = {
  code?: unknown;
  msg?: unknown;
  data?: Record<string, unknown>;
};

async function request(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`MinerU request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
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
  }, requestTimeoutMs));
  const taskId = created.task_id;
  if (typeof taskId !== "string" || !taskId) throw new Error("MinerU response has no task_id");

  const deadline = Date.now() + (input.pollTimeoutMs ?? 180_000);
  let zipUrl: string | undefined;
  while (Date.now() <= deadline) {
    const task = await envelope(await request(fetcher, `${baseUrl}/extract/task/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers,
    }, requestTimeoutMs));
    if (task.state === "failed") throw new Error(typeof task.err_msg === "string" ? task.err_msg : "MinerU parsing failed");
    if (task.state === "done") {
      if (typeof task.full_zip_url !== "string" || !task.full_zip_url) throw new Error("MinerU result has no full_zip_url");
      zipUrl = task.full_zip_url;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 3_000));
  }
  if (!zipUrl) throw new Error(`MinerU parse timed out after ${input.pollTimeoutMs ?? 180_000}ms`);

  const zipResponse = await request(fetcher, zipUrl, { method: "GET" }, Math.max(requestTimeoutMs, 60_000));
  const files = unzipSync(new Uint8Array(await zipResponse.arrayBuffer()));
  const names = Object.keys(files);
  const markdownName = names.find((name) => name.endsWith("full.md")) ?? names.find((name) => name.endsWith(".md"));
  if (!markdownName) throw new Error("MinerU result ZIP does not contain Markdown");
  const content = strFromU8(files[markdownName]!);
  if (!content.trim()) throw new Error("MinerU returned empty Markdown");
  return { parser: "mineru-premium-url", content, taskId };
}
