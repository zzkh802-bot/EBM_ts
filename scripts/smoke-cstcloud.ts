import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadProjectEnv } from "../src/server/projectEnv.js";

const BASE_URL = "https://uni-api.cstcloud.cn/v1";
const MODELS = ["deepseek-v4-flash", "qwen3.5"] as const;
const rootDir = path.resolve(import.meta.dirname, "..");
const projectEnv = await loadProjectEnv(rootDir);
const apiKey = process.env.CSTCloud_API_KEY || projectEnv.CSTCloud_API_KEY;

if (!apiKey) throw new Error("CSTCloud_API_KEY is missing (set it in the environment or project .env).");

type TestResult = { model: string; mode: "text" | "vision"; firstTokenMs?: number; totalMs: number; outputChars: number };

async function request(model: string, mode: "text" | "vision"): Promise<TestResult> {
  const content = mode === "vision"
    ? [
      { type: "text", text: "Reply with exactly: VISION_OK" },
      // A public documentation image validates multimodal request handling without user data.
      { type: "image_url", image_url: { url: "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241022/emyrja/dog_and_girl.jpeg" } },
    ]
    : "Reply with exactly: TEXT_OK";
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 32, temperature: 0, stream: true }),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let firstTokenMs: number | undefined;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const delta = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> };
        const text = delta.choices?.[0]?.delta?.content;
        if (text) {
          firstTokenMs ??= performance.now() - started;
          output += text;
        }
      } catch {
        // Ignore provider-specific SSE metadata that is not a completion chunk.
      }
    }
  }
  const totalMs = performance.now() - started;
  const expected = mode === "vision" ? "VISION_OK" : "TEXT_OK";
  if (!output.includes(expected)) throw new Error(`unexpected response: ${output.slice(0, 200)}`);
  return { model, mode, ...(firstTokenMs === undefined ? {} : { firstTokenMs }), totalMs, outputChars: output.length };
}

for (const model of MODELS) {
  const modes: Array<"text" | "vision"> = model === "qwen3.5" ? ["text", "vision"] : ["text"];
  for (const mode of modes) {
    try {
      const result = await request(model, mode);
      console.log(`OK  ${result.model.padEnd(20)} ${result.mode.padEnd(6)} first-token=${result.firstTokenMs?.toFixed(0) ?? "n/a"}ms total=${result.totalMs.toFixed(0)}ms chars=${result.outputChars}`);
    } catch (error) {
      console.error(`FAIL ${model} ${mode}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
