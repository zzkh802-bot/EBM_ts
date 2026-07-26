import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type BudgetResearchMode = "instant" | "expert" | "literature";

export type IterationBudgetReminderOptions = {
  researchMode?: BudgetResearchMode;
  maxIterations?: number;
};

const REMINDER_LEAD: Record<BudgetResearchMode, number> = {
  instant: 2,
  expert: 3,
  literature: 3,
};

function researchMode(value: string | undefined): BudgetResearchMode {
  return value === "expert" || value === "literature" ? value : "instant";
}

function iterationBudget(value: number | string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function budgetReminderText(mode: BudgetResearchMode, remaining: number): string {
  const common = `工具迭代预算即将用完，按当前计数最多约剩 ${remaining} 次调用。不要再进行宽泛或重复检索；请使用已经取得的证据完成正式报告，证据不足之处明确标注，并务必在结束前调用 report_write。`;
  if (mode === "instant") {
    return `【Instant 收束提醒】${common} 只保留影响临床决策的关键疗效、安全性、适用边界和简短建议，尽快输出。`;
  }
  if (mode === "expert") {
    return `【Expert 收束提醒】${common} 优先补齐仍会改变结论的核心证据；随后综合 PICO、效应量、证据冲突、不确定性、适用性和安全边界，尽快输出完整报告。`;
  }
  return `【Literature 收束提醒】${common} 优先完成关键文献的证据归档、来源层级判断和可核验引用，随后尽快输出。`;
}

export function registerIterationBudgetReminder(
  pi: Pick<ExtensionAPI, "on" | "sendMessage">,
  options: IterationBudgetReminderOptions = {},
): void {
  const mode = options.researchMode ?? researchMode(process.env.EBM_RESEARCH_MODE);
  const maxIterations = iterationBudget(options.maxIterations ?? process.env.EBM_MAX_ITERATIONS);
  if (maxIterations === 0) return;

  const reminderAt = Math.max(1, maxIterations - Math.min(REMINDER_LEAD[mode], maxIterations - 1));
  let completedToolCalls = 0;
  let reminderSent = false;

  pi.on("agent_start", async () => {
    completedToolCalls = 0;
    reminderSent = false;
  });

  pi.on("tool_execution_end", async () => {
    completedToolCalls += 1;
    if (reminderSent || completedToolCalls < reminderAt) return;
    reminderSent = true;
    const remaining = Math.max(0, maxIterations - completedToolCalls);
    pi.sendMessage({
      customType: "ebm-iteration-budget-reminder",
      content: budgetReminderText(mode, remaining),
      display: false,
      details: { mode, maxIterations, completedToolCalls, remaining },
    }, { deliverAs: "steer" });
  });
}
