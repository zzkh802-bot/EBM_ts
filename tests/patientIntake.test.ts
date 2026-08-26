import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPiPatientIntakeExecutor, PatientWorkspace, PATIENT_FREE_CHAT_TURN_LIMIT, PATIENT_VISIT_REPORT_HEADINGS, type PatientIntakeExecutor, type PatientIntakeInput, type PatientRpcClientOptions, validatePatientIntakeInput, validatePatientVisitReport } from "../src/server/patientIntake.js";

const profile = {
  id: "profile-1", revision: "revision-1", name: "我", sex: "female" as const, age: 34,
  allergies: "青霉素", pregnancy: "no" as const, memory: "长期服用左甲状腺素",
};

const request = (overrides: Partial<PatientIntakeInput> = {}): PatientIntakeInput => ({
  message: "最近总是睡不好", clientSessionId: "visit-1", intent: "conversation", mode: "visit_preparation",
  thinkingEnabled: true, profile, provider: "deepseek", model: "deepseek-v4-flash", ...overrides,
});

const executor: PatientIntakeExecutor = async (input) => ({
  sessionId: input.sessionId || `pi-${input.clientSessionId}`,
  reply: input.intent === "summary" ? report("睡眠问题") : "请说说大概从什么时候开始。",
});

function report(goal: string): string {
  return `## 此次就诊想解决什么\n\n${goal}\n\n## 发生经过\n\n尚未说明\n\n## 目前的感受与影响\n\n尚未说明\n\n## 已有检查、用药和相关情况\n\n尚未说明\n\n## 我想请医生帮助回答\n\n尚未说明\n\n## 还没说清楚的地方\n\n尚未说明`;
}

describe("患者工作区", () => {
  it("rejects malformed mode and profile fields instead of silently changing clinical context", () => {
    const runtime = {
      default_provider: "deepseek", default_model: "deepseek-v4-flash",
      models: [{ provider: "deepseek", model: "deepseek-v4-flash", available: true }],
    };
    const body = {
      message: "最近总是睡不好", client_session_id: "visit-1", mode: "visit_preparation", thinking_enabled: true,
      profile,
    };
    expect(() => validatePatientIntakeInput({ ...body, mode: "unknown" }, runtime)).toThrowError("mode 必须");
    expect(() => validatePatientIntakeInput({ ...body, thinking_enabled: "false" }, runtime)).toThrowError("布尔值");
    expect(() => validatePatientIntakeInput({ ...body, profile: { ...profile, pregnancy: "unknown" } }, runtime)).toThrowError("profile.pregnancy 无效");
  });

  it("maps each product session to an isolated Pi session and rejects profile mixing", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-patient-workspace-"));
    const workspace = new PatientWorkspace(rootDir);
    const signal = new AbortController().signal;
    const first = await workspace.execute(request(), "conversation", executor, signal);
    expect(first.sessionId).toBe("pi-visit-1");
    const seen: PatientIntakeInput[] = [];
    await workspace.execute(request({ message: "大约两周" }), "conversation", async (input) => {
      seen.push(input);
      return executor(input, signal);
    }, signal);
    expect(seen[0]).toMatchObject({ sessionId: "pi-visit-1", profile: { id: "profile-1", memory: "长期服用左甲状腺素" } });
    await expect(workspace.execute(request({ profile: { ...profile, id: "profile-2" } }), "conversation", executor, signal))
      .rejects.toMatchObject({ code: "session_profile_mismatch" });
  });

  it("enforces the free-chat limit on the server and never accepts a report", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-patient-free-"));
    const workspace = new PatientWorkspace(rootDir);
    const signal = new AbortController().signal;
    const { profile: _profile, ...free } = request({ clientSessionId: "free-1", mode: "free_chat" });
    for (let turn = 0; turn < PATIENT_FREE_CHAT_TURN_LIMIT; turn += 1) await workspace.execute(free, "conversation", executor, signal);
    await expect(workspace.execute(free, "conversation", executor, signal)).rejects.toMatchObject({ code: "free_chat_limit_reached" });
    await expect(workspace.execute(free, "summary", executor, signal)).rejects.toMatchObject({ code: "report_not_available" });
  });

  it("archives every generated report instead of overwriting the previous version", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-patient-report-"));
    const workspace = new PatientWorkspace(rootDir);
    const signal = new AbortController().signal;
    await workspace.execute(request(), "conversation", executor, signal);
    const first = await workspace.execute(request(), "summary", executor, signal);
    const second = await workspace.execute(request(), "summary", async (input) => ({ sessionId: input.sessionId!, reply: report("复诊睡眠问题") }), signal);
    expect(first.reportPath).toContain("report-001.md");
    expect(second.reportPath).toContain("report-002.md");
    expect(await readFile(path.join(rootDir, first.reportPath!), "utf8")).toContain("睡眠问题");
    expect(await readFile(path.join(rootDir, second.reportPath!), "utf8")).toContain("复诊睡眠问题");
  });

  it("rejects a report that does not follow the patient writing skill structure", () => {
    expect(() => validatePatientVisitReport("## 此次就诊想解决什么\n\n睡眠问题")).toThrowError("格式不完整");
    expect(validatePatientVisitReport(report("睡眠问题"))).toContain("## 还没说清楚的地方");
  });

  it("keeps the enforced report headings aligned with the patient writing skill", async () => {
    const skill = await readFile(path.join(process.cwd(), ".pi", "skills", "patient-visit-preparation", "SKILL.md"), "utf8");
    for (const heading of PATIENT_VISIT_REPORT_HEADINGS) expect(skill).toContain(`## ${heading}`);
  });

  it("passes patient skill contents to Pi instead of passing the file path", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-patient-pi-"));
    const cliDirectory = path.join(rootDir, "node_modules", "@earendil-works", "pi-coding-agent", "dist");
    const skillDirectory = path.join(rootDir, ".pi", "skills", "patient-visit-preparation");
    await mkdir(cliDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(rootDir, ".pi", "models.json"), "{}\n");
    await writeFile(path.join(skillDirectory, "SKILL.md"), "PATIENT_SKILL_BODY\n");
    await writeFile(path.join(cliDirectory, "cli.js"), "");
    let options: PatientRpcClientOptions | undefined;
    const runtime = createPiPatientIntakeExecutor({
      rootDir,
      clientFactory: (value) => {
        options = value;
        return {
          start: async () => undefined,
          stop: async () => undefined,
          getState: async () => ({ sessionId: "pi-fake", thinkingLevel: "medium", isStreaming: false }),
          setThinkingLevel: async () => undefined,
          prompt: async () => undefined,
          waitForIdle: async () => undefined,
          abort: async () => undefined,
          getLastAssistantText: async () => {
            const skill = options?.args[options.args.indexOf("--append-system-prompt") + 1] || "";
            const extension = options?.args[options.args.indexOf("--extension") + 1] || "";
            return skill.includes("PATIENT_SKILL_BODY") && extension.endsWith("ebm-providers.ts")
              ? "skill-and-provider-loaded"
              : "runtime-missing";
          },
        };
      },
    });
    const result = await runtime(request(), new AbortController().signal);
    expect(result).toMatchObject({ sessionId: "pi-fake", reply: "skill-and-provider-loaded" });
    expect(options?.args).not.toContain("json");
    await runtime.dispose();
  });
});
