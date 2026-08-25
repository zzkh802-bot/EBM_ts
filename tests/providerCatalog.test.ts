import { describe, expect, it } from "vitest";
import { XINQIONG_PROVIDER_ID, registerEbmProviders } from "../src/providers/providerCatalog.js";

describe("EBM provider catalog", () => {
  it("registers only Xinqiong and leaves official DeepSeek to Pi's native provider", () => {
    const calls: Array<[string, unknown]> = [];
    registerEbmProviders({ registerProvider: (id: string, config: unknown) => calls.push([id, config]) } as never);

    expect(calls.map(([id]) => id)).toEqual([XINQIONG_PROVIDER_ID]);
    expect(calls[0]![1]).toMatchObject({
      api: "openai-completions",
      apiKey: "$OPENAI_API_KEY",
      baseUrl: "https://cloud.infini-ai.com/maas/deepseek-v4-flash/nvidia",
      models: [expect.objectContaining({ id: "deepseek-v4-flash-0731" })],
    });
  });
});
