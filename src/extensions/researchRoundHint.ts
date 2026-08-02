import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function iterationBudget(): number | undefined {
  const value = Number.parseInt(process.env.EBM_MAX_ITERATIONS ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function registerResearchRoundHint(pi: Pick<ExtensionAPI, "on">): void {
  let currentTurn = 1;

  pi.on("turn_start", (event) => {
    currentTurn = event.turnIndex + 1;
  });

  pi.on("context", (event) => {
    const budget = iterationBudget();
    if (!budget) return;
    return {
      messages: [...event.messages, {
        role: "user",
        content: [{
          type: "text",
          text: `[运行状态，仅用于控制研究范围，不代表新的临床问题：当前为第 ${currentTurn} 个研究轮次；建议预算为 ${budget} 轮。若证据已足以回答，请优先完成证据记录与正式报告，不为凑轮次扩展检索。]`,
        }],
        timestamp: Date.now(),
      }],
    };
  });
}
