import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const DEEPSEEK_PROVIDER_ID = "deepseek-official";
export const XINQIONG_PROVIDER_ID = "xinqiong";

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export function registerEbmProviders(pi: Pick<ExtensionAPI, "registerProvider">): void {
  pi.registerProvider(DEEPSEEK_PROVIDER_ID, {
    name: "DeepSeek Official",
    baseUrl: "https://api.deepseek.com",
    apiKey: "$DEEPSEEK_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        reasoning: false,
        input: ["text"],
        cost: zeroCost,
        contextWindow: 128000,
        maxTokens: 8192,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
          thinkingFormat: "deepseek",
        },
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
        input: ["text"],
        cost: zeroCost,
        contextWindow: 128000,
        maxTokens: 32768,
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

  pi.registerProvider(XINQIONG_PROVIDER_ID, {
    name: "Xinqiong / Infini-AI OpenAI-Compatible",
    baseUrl: "https://cloud.infini-ai.com/maas/deepseek-v4-flash/nvidia",
    apiKey: "$XINQIONG_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash via Xinqiong",
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", xhigh: null, max: "max" },
        input: ["text"],
        cost: zeroCost,
        contextWindow: 256000,
        maxTokens: 32768,
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
