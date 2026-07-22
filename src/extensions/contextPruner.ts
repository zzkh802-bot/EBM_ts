import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pruneLargeToolResults } from "../tools/contextPrune.js";
import { formatBeijingTimestamp } from "../tools/time.js";
import { piSessionDirectory } from "./sessionPath.js";

const DEFAULT_PRUNE_THRESHOLD_TOKENS = 250_000;
const PRUNE_ONCE_MARKER = path.join("context_prune", ".pruned-at-250k");

function sessionFilePath(ctx: any): string {
  const file = ctx.sessionManager.getSessionFile();
  return path.isAbsolute(file) ? file : path.join(ctx.sessionManager.getSessionDir(), file);
}

export function registerContextPruner(pi: Pick<ExtensionAPI, "on" | "events">): void {
  pi.on("agent_settled", async (_event, ctx) => {
    const usage = ctx.getContextUsage?.();
    const tokens = usage?.tokens;
    if (typeof tokens !== "number" || tokens < DEFAULT_PRUNE_THRESHOLD_TOKENS) return;
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionDir = piSessionDirectory(ctx.cwd, sessionId);
    const markerPath = path.join(sessionDir, PRUNE_ONCE_MARKER);
    if (existsSync(markerPath)) return;
    await mkdir(path.dirname(markerPath), { recursive: true, mode: 0o700 });
    let claimed = true;
    await writeFile(markerPath, `${formatBeijingTimestamp()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        claimed = false;
        return;
      }
      throw error;
    });
    if (!claimed) return;
    const sessionWorkspace = ["data", "sessions", path.basename(sessionDir)].join("/");
    const result = await pruneLargeToolResults({
      sessionFile: sessionFilePath(ctx),
      sessionDir,
      readableSessionWorkspace: sessionWorkspace,
    });
    if (result.pruned > 0) {
      pi.events.emit("ebm:context_pruned", { sessionId, tokens, pruned: result.pruned, archived: result.archived });
    }
  });
}
