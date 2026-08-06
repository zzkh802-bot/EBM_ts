import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function iterationBudget(): number | undefined {
  const value = Number.parseInt(process.env.EBM_MAX_ITERATIONS ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function sourceReviewBudget(): number {
  const value = Number.parseInt(process.env.EBM_SOURCE_REVIEW_BUDGET ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 8;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isFullSourceReview(toolName: string, args: unknown): boolean {
  if (["guideline_mcp_read", "pubmed_read", "web_read"].includes(toolName)) return true;
  const input = recordValue(args);
  if (toolName === "read") return typeof input?.path === "string" && /(?:^|\/)sources\/read\//.test(input.path.replaceAll("\\", "/"));
  if (toolName === "bash") return typeof input?.command === "string" && /(?:^|[\s'"/])sources\/read\//.test(input.command.replaceAll("\\", "/"));
  return false;
}

export function registerResearchRoundHint(pi: Pick<ExtensionAPI, "on">): void {
  let currentTurn = 1;
  let sourceReviews = 0;

  pi.on("before_agent_start", () => {
    currentTurn = 1;
    sourceReviews = 0;
  });

  pi.on("turn_start", (event) => {
    currentTurn = event.turnIndex + 1;
  });

  pi.on("tool_execution_start", (event) => {
    if (isFullSourceReview(event.toolName, event.args)) sourceReviews += 1;
  });

  pi.on("context", (event) => {
    const rounds = iterationBudget();
    const reviewBudget = sourceReviewBudget();
    const exhausted = sourceReviews >= reviewBudget;
    const roundText = rounds ? `当前为第 ${currentTurn} 个研究轮次；建议预算为 ${rounds} 轮。` : `当前为第 ${currentTurn} 个研究轮次。`;
    const reviewText = exhausted
      ? `完整来源复核预算已用 ${sourceReviews}/${reviewBudget}。停止继续翻阅来源；除非能明确指出仍缺少哪一项足以逆转临床结论的信息，否则请登记已有证据、披露缺口并进入正式报告。`
      : `完整来源复核预算已用 ${sourceReviews}/${reviewBudget}。优先使用已读取片段的 read_id + 起止原文锚点归档证据；只为适用性、冲突或决策关键缺口继续打开完整来源。`;
    return {
      messages: [...event.messages, {
        role: "user",
        content: [{
          type: "text",
          text: `[运行状态，仅用于控制研究范围，不代表新的临床问题：${roundText}${reviewText} guideline_mcp_retrieve 等聚焦检索和 evidence_add 不计入完整来源复核预算。若证据已足以回答，请优先完成证据记录与正式报告，不为凑轮次扩展检索。]`,
        }],
        timestamp: Date.now(),
      }],
    };
  });
}
