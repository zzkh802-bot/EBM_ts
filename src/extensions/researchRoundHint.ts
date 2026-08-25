import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function iterationBudget(): number | undefined {
  const value = Number.parseInt(process.env.EBM_MAX_ITERATIONS ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function registerResearchRoundHint(pi: Pick<ExtensionAPI, "on" | "events">): void {
  let currentTurn = 1;

  pi.on("before_agent_start", () => {
    currentTurn = 1;
  });

  pi.on("turn_start", (event) => {
    currentTurn = event.turnIndex + 1;
  });

  pi.on("context", (event) => {
    const rounds = iterationBudget();
    const quickMode = process.env.EBM_RESEARCH_MODE === "quick";
    const closingRound = rounds ?? 8;
    const roundText = rounds ? `当前为第 ${currentTurn} 个研究轮次；建议预算为 ${rounds} 轮。` : `当前为第 ${currentTurn} 个研究轮次。`;
    const quickClosingInstruction = currentTurn >= closingRound
      ? `这是快速模式的第 ${closingRound} 轮收束点：现在必须基于已读取、可核对的来源直接完成带自动引用标记的回答；不得开始新的检索或阅读。资料仍有缺口时，说明不确定性后仍要作答。`
      : "快速模式可并行进行少量高价值检索与阅读；不要登记 evidence_add 或写正式报告。证据已足以回答时立即生成带自动引用标记的直接回答。";
    const reminder = quickMode
      ? "[运行状态，仅用于控制研究范围，不代表新的临床问题：" + roundText + quickClosingInstruction + "]"
      : "[运行状态，仅用于控制研究范围，不代表新的临床问题：" + roundText + "读取、核验和证据登记都属于当前研究阶段；优先使用已读取片段的 read_id 与起止原文锚点归档证据。若证据已足以回答，请优先完成证据记录与正式报告，不为凑轮次扩展检索。]";
    pi.events?.emit?.("ebm:system_reminder", { text: reminder, source: "research_round_hint", turn_index: currentTurn });
    return {
      messages: [...event.messages, {
        role: "user",
        content: [{
          type: "text",
          text: reminder,
        }],
        timestamp: Date.now(),
      }],
    };
  });
}
