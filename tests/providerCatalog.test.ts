import { describe, expect, it } from "vitest";
import { DEEPSEEK_PROVIDER_ID, XINQIONG_PROVIDER_ID, registerEbmProviders } from "../src/providers/providerCatalog.js";

describe("EBM provider catalog", () => {
  it("registers DeepSeek official and Xinqiong providers without custom streaming code", () => {
    const calls: Array<[string, unknown]> = [];
    registerEbmProviders({ registerProvider: (id: string, config: unknown) => calls.push([id, config]) } as never);

    expect(calls.map(([id]) => id)).toEqual([DEEPSEEK_PROVIDER_ID, XINQIONG_PROVIDER_ID]);
    expect(calls[0]![1]).toMatchObject({ api: "openai-completions", apiKey: "$DEEPSEEK_API_KEY" });
    expect(calls[1]![1]).toMatchObject({ api: "openai-completions", apiKey: "$XINQIONG_API_KEY" });
  });
});
