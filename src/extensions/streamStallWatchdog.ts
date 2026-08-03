import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function configuredTimeoutMs(): number | undefined {
  const value = Number.parseInt(process.env.EBM_STREAM_STALL_TIMEOUT_MS ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function registerStreamStallWatchdog(pi: Pick<ExtensionAPI, "on" | "events">): void {
  let active = false;
  let activeTools = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (ctx: ExtensionContext) => {
    clear();
    const timeoutMs = configuredTimeoutMs();
    if (!timeoutMs || !active || activeTools > 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!active || activeTools > 0 || ctx.isIdle() || ctx.signal?.aborted) return;
      active = false;
      pi.events.emit("ebm:stream_stalled", {
        sessionId: ctx.sessionManager.getSessionId(),
        timeoutMs,
        timestamp: new Date().toISOString(),
      });
      ctx.abort();
    }, timeoutMs);
  };

  pi.on("before_agent_start", () => {
    clear();
    active = true;
    activeTools = 0;
  });
  pi.on("before_provider_request", (_event, ctx) => arm(ctx));
  pi.on("after_provider_response", (_event, ctx) => arm(ctx));
  pi.on("message_start", (_event, ctx) => arm(ctx));
  pi.on("message_update", (_event, ctx) => arm(ctx));
  pi.on("message_end", (_event, ctx) => arm(ctx));
  pi.on("tool_execution_start", () => {
    activeTools += 1;
    clear();
  });
  pi.on("tool_execution_end", (_event, ctx) => {
    activeTools = Math.max(0, activeTools - 1);
    arm(ctx);
  });
  pi.on("agent_end", () => {
    active = false;
    clear();
  });
  pi.on("agent_settled", () => {
    active = false;
    clear();
  });
}
