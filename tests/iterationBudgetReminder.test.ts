import { describe, expect, it } from "vitest";
import { budgetReminderText, registerIterationBudgetReminder } from "../src/extensions/iterationBudgetReminder.js";

function harness() {
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
  const sent: Array<{ message: any; options: any }> = [];
  const pi = {
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    sendMessage(message: any, options: any) {
      sent.push({ message, options });
    },
  };
  return {
    pi,
    sent,
    async emit(name: string) {
      for (const handler of handlers.get(name) ?? []) await handler({ type: name }, {});
    },
  };
}

describe("iteration budget reminder", () => {
  it("reminds Instant once when two tool calls remain", async () => {
    const test = harness();
    registerIterationBudgetReminder(test.pi as never, { researchMode: "instant", maxIterations: 5 });
    await test.emit("agent_start");
    await test.emit("tool_execution_end");
    await test.emit("tool_execution_end");
    expect(test.sent).toHaveLength(0);
    await test.emit("tool_execution_end");
    await test.emit("tool_execution_end");
    expect(test.sent).toHaveLength(1);
    expect(test.sent[0]?.message.content).toContain("Instant 收束提醒");
    expect(test.sent[0]?.message.content).toContain("report_write");
    expect(test.sent[0]?.message.details).toMatchObject({ maxIterations: 5, completedToolCalls: 3, remaining: 2 });
    expect(test.sent[0]?.options).toEqual({ deliverAs: "steer" });
  });

  it("gives Expert three remaining calls and resets for a new run", async () => {
    const test = harness();
    registerIterationBudgetReminder(test.pi as never, { researchMode: "expert", maxIterations: 12 });
    await test.emit("agent_start");
    for (let index = 0; index < 9; index += 1) await test.emit("tool_execution_end");
    expect(test.sent).toHaveLength(1);
    expect(test.sent[0]?.message.content).toContain("Expert 收束提醒");
    expect(test.sent[0]?.message.details.remaining).toBe(3);
    await test.emit("agent_start");
    for (let index = 0; index < 9; index += 1) await test.emit("tool_execution_end");
    expect(test.sent).toHaveLength(2);
  });

  it("uses mode-specific Literature guidance", () => {
    expect(budgetReminderText("literature", 3)).toContain("关键文献");
    expect(budgetReminderText("literature", 3)).toContain("可核验引用");
  });
});
