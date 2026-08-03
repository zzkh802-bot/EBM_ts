import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializePiSessionDirectory } from "../session/sessionPath.js";

export * from "../session/sessionPath.js";

/** Pi extension hook that initializes the product workspace before tools write artifacts. */
export function registerSessionWorkspace(pi: Pick<ExtensionAPI, "on">): void {
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionName = ctx.sessionManager.getSessionName();
    await initializePiSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId(), {
      ...(sessionName ? { sessionName } : {}),
      firstPrompt: event.prompt,
    });
  });
}
