import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { piSessionDirectory } from "./sessionPath.js";

const SECRET_PATH = new RegExp("(?:^|[\\s/'\\\"`])(?:\\.env(?:\\.[\\w.-]+)?|auth\\.json|\\.ssh|\\.aws|id_(?:rsa|ed25519)|credentials(?:\\.json)?|/proc(?:/|$)|/etc/shadow)(?:$|[\\s/'\\\"`])", "i");
const SECRET_COMMAND = /(?:^|[;&|\s])(?:env|printenv|export(?:\s+-p)?)(?:$|[;&|\s])/i;
const DANGEROUS_COMMAND = /(?:^|[;&|\s])(?:sudo|su|ssh|scp|nc|ncat|curl|wget|git\s+(?:clone|push|remote)|npm\s+(?:install|i)|pnpm\s+(?:install|add)|yarn\s+add|rm\s+-[^\n]*r|mkfs(?:\.|\s)|dd\s+if=|chmod\s+777|chown\s+)(?=$|[;&|\s])/i;

/** Defense-in-depth guard for the internal beta; OS/container isolation remains the real boundary. */
export function registerSecurityGuard(pi: Pick<ExtensionAPI, "on">): void {
  pi.on("tool_call", (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command.trim();
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionPath = piSessionDirectory(ctx.cwd, sessionId).replaceAll("\\", "/");
      if (SECRET_PATH.test(command)) return { block: true, reason: "为保护内部服务密钥和主机凭据，Bash 不允许读取敏感路径。" };
      if (SECRET_COMMAND.test(command) || /process\.env|import\.meta\.env/i.test(command)) return { block: true, reason: "为保护内部服务密钥，不允许通过环境变量枚举或读取运行时密钥。" };
      if (DANGEROUS_COMMAND.test(command)) return { block: true, reason: "该 Bash 命令被内部测试安全策略拦截。请使用循医的专用检索工具或当前会话文件。" };
      if (command.includes("data/sessions/") && (command.includes("..") || (!command.includes(sessionPath) && !command.includes(`data/sessions/${sessionId}`)))) {
        return { block: true, reason: "Bash 只能访问当前研究会话的归档目录。" };
      }
    }
    if (isToolCallEventType("read", event) || isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const candidate = typeof event.input.path === "string" ? event.input.path : "";
      if (SECRET_PATH.test(candidate)) return { block: true, reason: "为保护内部服务密钥和主机凭据，不允许访问敏感路径。" };
    }
    return undefined;
  });
}
