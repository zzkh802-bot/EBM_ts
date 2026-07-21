import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { registerEbmProviders } from "../providers/providerCatalog.js";

export type CreateEbmSessionOptions = {
  cwd: string;
  agentDir?: string;
  model?: string;
};

export async function createEbmSession(options: CreateEbmSessionOptions) {
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir ?? getAgentDir(),
    settingsManager,
    extensionFactories: [{ name: "ebm-providers", factory: registerEbmProviders }],
    systemPromptOverride: () => [
      "You are an Evidence-Based Medicine research agent.",
      "Use the smallest sufficient tool set. Archive sources before citing them.",
      "Do not invent citations. Evidence claims must point to exact source slices.",
      "Prefer PICO framing, guidelines, systematic reviews, and RCTs when relevant.",
    ].join("\n"),
  });
  await loader.reload();
  const modelRuntime = await ModelRuntime.create();
  return createAgentSession({
    cwd: options.cwd,
    modelRuntime,
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(options.cwd),
    tools: ["read", "write", "edit", "grep", "find", "ls", "bash"],
  });
}
