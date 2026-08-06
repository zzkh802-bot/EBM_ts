import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { piSessionDirectory } from "./sessionPath.js";

const SECRET_PATH = new RegExp("(?:^|[\\s/'\\\"`])(?:\\.env(?:\\.[\\w.-]+)?|auth\\.json|\\.ssh|\\.aws|id_(?:rsa|ed25519)|credentials(?:\\.json)?|/proc(?:/|$)|/etc/shadow)(?:$|[\\s/'\\\"`])", "i");
const SECRET_COMMAND = /(?:^|[;&|\s])(?:env|printenv|export(?:\s+-p)?)(?:$|[;&|\s])/i;
const DANGEROUS_COMMAND = /(?:^|[;&|\s])(?:sudo|su|ssh|scp|nc|ncat|curl|wget|git\s+(?:clone|push|remote)|npm\s+(?:install|i)|pnpm\s+(?:install|add)|yarn\s+add|rm\s+-[^\n]*r|mkfs(?:\.|\s)|dd\s+if=|chmod\s+777|chown\s+)(?=$|[;&|\s])/i;

type NativePathAction = "read" | "write" | "edit";

function normalizeCandidate(value: string): string {
  return value.trim().replace(/^@/, "").replaceAll("\\", "/");
}

function realPathForPolicy(candidate: string): string {
  const resolved = path.resolve(candidate);
  if (existsSync(resolved)) return realpathSync(resolved);
  const parent = path.dirname(resolved);
  try { return path.join(realpathSync(parent), path.basename(resolved)); } catch { return resolved; }
}

/** Native file tools may read project instructions, but may only mutate/read the active workspace. */
export function nativePathAllowed(cwd: string, sessionId: string, candidate: string, action: NativePathAction): boolean {
  const value = normalizeCandidate(candidate);
  if (!value) return false;
  const workspace = realPathForPolicy(piSessionDirectory(cwd, sessionId));
  const resolved = realPathForPolicy(path.resolve(cwd, value));
  const inside = (root: string) => resolved === root || resolved.startsWith(`${root}${path.sep}`);
  if (inside(workspace)) {
    if (action === "read") return true;
    return ["artifacts", "reports", "notes"].some((directory) => inside(realPathForPolicy(path.join(workspace, directory))));
  }
  const projectInstructions = realPathForPolicy(path.join(cwd, ".pi"));
  return action === "read" && inside(projectInstructions);
}

/**
 * Bash commands normally use the human-readable workspace directory
 * (`data/sessions/<slug>`), while the Pi session id is a UUID. Keep the
 * policy check tied to the resolved active workspace instead of assuming
 * those two names are identical.
 */
export function bashCommandPathAllowed(cwd: string, sessionId: string, command: string): boolean {
  const normalizedCommand = command.replaceAll("\\", "/");
  if (!normalizedCommand.includes("data/sessions/")) return true;
  const workspace = path.resolve(piSessionDirectory(cwd, sessionId));
  const relativeWorkspace = path.relative(path.resolve(cwd), workspace).replaceAll("\\", "/");
  const markers = [
    workspace.replaceAll("\\", "/"),
    relativeWorkspace,
    `data/sessions/${path.basename(workspace)}`,
    `data/sessions/${sessionId}`,
  ].filter(Boolean);
  return markers.some((marker) => {
    const index = normalizedCommand.indexOf(marker);
    if (index < 0) return false;
    const next = normalizedCommand[index + marker.length];
    return next === undefined || /[\/\s'"`]/.test(next);
  });
}

/** Defense-in-depth guard for the internal beta; OS/container isolation remains the real boundary. */
export function registerSecurityGuard(pi: Pick<ExtensionAPI, "on">): void {
  pi.on("tool_call", (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command.trim();
      const sessionId = ctx.sessionManager.getSessionId();
      if (SECRET_PATH.test(command)) return { block: true, reason: "为保护内部服务密钥和主机凭据，Bash 不允许读取敏感路径。" };
      if (SECRET_COMMAND.test(command) || /process\.env|import\.meta\.env/i.test(command)) return { block: true, reason: "为保护内部服务密钥，不允许通过环境变量枚举或读取运行时密钥。" };
      if (DANGEROUS_COMMAND.test(command)) return { block: true, reason: "该 Bash 命令被内部测试安全策略拦截。请使用循医的专用检索工具或当前会话文件。" };
      if (command.includes("data/sessions/") && (command.includes("..") || !bashCommandPathAllowed(ctx.cwd, sessionId, command))) {
        return { block: true, reason: "Bash 只能访问当前研究会话的归档目录。" };
      }
    }
    if (isToolCallEventType("read", event) || isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const candidate = typeof event.input.path === "string" ? event.input.path : "";
      if (SECRET_PATH.test(candidate)) return { block: true, reason: "为保护内部服务密钥和主机凭据，不允许访问敏感路径。" };
      const action = isToolCallEventType("read", event) ? "read" : isToolCallEventType("write", event) ? "write" : "edit";
      if (!nativePathAllowed(ctx.cwd, ctx.sessionManager.getSessionId(), candidate, action)) {
        return { block: true, reason: "原生文件工具只能访问当前研究会话；研究资料请使用循医的归档工具。" };
      }
    }
    return undefined;
  });
}
