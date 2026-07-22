import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODING_IDENTITY = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const EBM_IDENTITY = "You are an expert evidence-based medicine (EBM) agent operating inside Pi, an agent harness. You help users answer clinical questions by researching evidence, using tools, reading and writing files, and producing verifiable reports.";

export function adaptEbmSystemPrompt(systemPrompt: string): string {
  return systemPrompt.startsWith(CODING_IDENTITY)
    ? `${EBM_IDENTITY}${systemPrompt.slice(CODING_IDENTITY.length)}`
    : systemPrompt;
}

export function registerEbmIdentity(pi: Pick<ExtensionAPI, "on">): void {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: adaptEbmSystemPrompt(event.systemPrompt),
  }));
}
