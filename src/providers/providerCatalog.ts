import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const XINQIONG_PROVIDER_ID = "xinqiong";

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export function registerEbmProviders(pi: Pick<ExtensionAPI, "registerProvider">): void {
  // Official DeepSeek is intentionally not registered here: Pi ships a native
  // DeepSeek provider with current V4 model metadata and protocol handling.
  pi.registerProvider(XINQIONG_PROVIDER_ID, {
    name: "Xinqiong / Infini-AI OpenAI-Compatible",
    baseUrl: process.env.XINQIONG_BASE_URL || "https://cloud.infini-ai.com/maas/deepseek-v4-flash/nvidia",
    apiKey: process.env.XINQIONG_API_KEY || "$OPENAI_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash via Xinqiong",
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
        input: ["text"],
        cost: zeroCost,
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          thinkingFormat: "deepseek",
        },
      },
    ],
  });
}
