import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { saveCompactionArtifact } from "../tools/compactionArtifact.js";
import { piSessionDirectory } from "./sessionPath.js";

export function registerCompactionArtifacts(pi: ExtensionAPI): void {
  pi.on("session_compact", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const result = await saveCompactionArtifact({
      sessionDir: piSessionDirectory(ctx.cwd, sessionId),
      sessionId,
      reason: event.reason,
      willRetry: event.willRetry,
      fromExtension: event.fromExtension,
      entry: event.compactionEntry,
    });
    pi.events.emit("ebm:compaction_archived", { sessionId, path: result.path, reason: event.reason });
  });
}
