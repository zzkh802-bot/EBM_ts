import { describe, expect, it } from "vitest";
import { adaptEbmSystemPrompt, withSessionCreatedDate } from "../src/extensions/ebmIdentity.js";

const original = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read
- bash

Guidelines:
- Be concise`;

describe("EBM system identity", () => {
  it("changes only Pi's coding identity and preserves the generated prompt", () => {
    const adapted = adaptEbmSystemPrompt(original);
    expect(adapted).toMatch(/^You are an expert evidence-based medicine \(EBM\) agent/);
    expect(adapted).toContain("Available tools:\n- read\n- bash");
    expect(adapted).toContain("Guidelines:\n- Be concise");
    expect(adapted).not.toContain("expert coding assistant");
  });

  it("leaves unknown custom prompts unchanged", () => {
    expect(adaptEbmSystemPrompt("Custom prompt")).toBe("Custom prompt");
  });

  it("can append a stable day-precision session date", () => {
    const prompted = withSessionCreatedDate("System", "2026-07-22");
    expect(prompted).toContain("EBM session date: 2026-07-22");
    expect(prompted).toContain("fixed for the current session");
    expect(withSessionCreatedDate("System")).toBe("System");
  });
});
