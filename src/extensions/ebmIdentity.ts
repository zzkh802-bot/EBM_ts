import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializePiSessionDirectory, piSessionCreatedDate } from "./sessionPath.js";

const CODING_IDENTITY = "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
const EBM_IDENTITY = "You are an expert evidence-based medicine (EBM) agent operating inside Pi, an agent harness. You help users answer clinical questions by researching evidence, using tools, reading and writing files, and producing verifiable reports.";

export function adaptEbmSystemPrompt(systemPrompt: string): string {
  return systemPrompt.startsWith(CODING_IDENTITY)
    ? `${EBM_IDENTITY}${systemPrompt.slice(CODING_IDENTITY.length)}`
    : systemPrompt;
}

export function withSessionCreatedDate(systemPrompt: string, date?: string): string {
  if (!date) return systemPrompt;
  return `${systemPrompt}\n\nEBM session date: ${date}. This date is fixed for the current session and is precise only to the day; use it as the stable reference point for "recent", "last 3 years", and guideline freshness judgments, not as a real-time clock.`;
}

export function registerEbmIdentity(pi: Pick<ExtensionAPI, "on">): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionName = ctx.sessionManager.getSessionName();
    const sessionId = ctx.sessionManager.getSessionId();
    await initializePiSessionDirectory(ctx.cwd, sessionId, {
      ...(sessionName ? { sessionName } : {}),
      firstPrompt: event.prompt,
    });
    return {
      systemPrompt: withSessionCreatedDate(adaptEbmSystemPrompt(event.systemPrompt), piSessionCreatedDate(ctx.cwd, sessionId)),
    };
  });
}
