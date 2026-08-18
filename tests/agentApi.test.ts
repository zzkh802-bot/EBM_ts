import { once } from "node:events";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentPrompt, createAgentApiServer, formatQuickAnswerReferences, type AgentExecutor, type AgentRunInput, type AgentRunResponse, type RuntimeConfig } from "../src/server/agentApi.js";
import { buildPatientIntakePrompt, type PatientIntakeInput } from "../src/server/patientIntake.js";
import { archiveSource } from "../src/tools/archive.js";
import { addEvidence } from "../src/tools/evidence.js";
import { registerReadReceipt } from "../src/tools/readRegistry.js";
import { writeReport } from "../src/tools/report.js";
import { InternalAuthStore } from "../src/server/internalAuth.js";

type TestRunResponse = Omit<AgentRunResponse, "agent_trace" | "progress_updates" | "tools" | "summary"> & {
  agent_trace: Array<{ kind: string; label?: string }>;
  progress_updates: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
};

async function startApi(executor: AgentExecutor, runtimeConfig?: RuntimeConfig, rootDir?: string, staticDir?: string) {
  const api = createAgentApiServer({ executor, ...(runtimeConfig ? { runtimeConfig } : {}), ...(rootDir ? { rootDir } : {}), ...(staticDir ? { staticDir } : {}) });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const address = api.server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
  return { api, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for API result");
}

describe("循医研究服务 API", () => {
  const promptInput = (overrides: Partial<AgentRunInput> = {}): AgentRunInput => ({
    question: "测试临床问题",
    audienceMode: "clinician",
    thinkingLevel: "high",
    searchEnabled: true,
    retrievalPolicy: "all",
    responseMode: "report",
    maxIterations: 32,
    requestTimeoutSeconds: 600,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    ...overrides,
  });

  it("uses the shared internal key as an access gate and keeps agent runs user-scoped", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-auth-api-"));
    const runtimeConfig: RuntimeConfig = {
      default_provider: "deepseek", default_model: "deepseek-v4-flash",
      models: [{ provider: "deepseek", provider_label: "DeepSeek", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: true }],
    };
    const api = createAgentApiServer({ executor: async () => ({ sessionId: "owned-session", message: "完成。" }), rootDir, runtimeConfig, internalAccessKey: "shared-test-key" });
    api.server.listen(0, "127.0.0.1");
    await once(api.server, "listening");
    const address = api.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const config = await fetch(`${baseUrl}/api/v1/auth/config`);
      expect(await config.json()).toEqual({ auth_required: true });
      const denied = await fetch(`${baseUrl}/api/v1/agent-runs`);
      expect(denied.status).toBe(401);
      const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: "同名标注员", password: "test-pass-1", invite_key: "shared-test-key" }),
      });
      expect(registration.status).toBe(201);
      const registered = await registration.json() as { user: { id: string } };
      expect(registered.user.id).toMatch(/^u-[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
      const cookie = registration.headers.get("set-cookie");
      expect(cookie).toContain("ebm_internal_session=");
      const sessionCookie = cookie!.split(";")[0]!;
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie }, body: JSON.stringify({ question: "内部测试问题" }),
      });
      expect(created.status).toBe(202);
      const accepted = await created.json() as { run_id: string };
      const own = await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`, { headers: { cookie: sessionCookie } });
      expect(own.status).toBe(200);
      const secondRegistration = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: "另一位", password: "test-pass-2", invite_key: "shared-test-key" }),
      });
      expect(secondRegistration.status).toBe(201);
      const otherRegistration = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: "同名标注员", password: "test-pass-2", invite_key: "shared-test-key" }),
      });
      expect(otherRegistration.status).toBe(201);
      const otherCookie = otherRegistration.headers.get("set-cookie")!.split(";")[0]!;
      const crossUser = await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`, { headers: { cookie: otherCookie } });
      expect(crossUser.status).toBe(404);
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("keeps a valid login session across a backend restart", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-auth-session-"));
    const first = new InternalAuthStore("restart-test-key", rootDir);
    const registration = await first.register("重启测试", "test-pass-1", "restart-test-key", "test-client");
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const restarted = new InternalAuthStore("restart-test-key", rootDir);
    const request = { headers: { cookie: restarted.cookie(registration.token, false).split(";")[0] } } as unknown as import("node:http").IncomingMessage;
    expect(restarted.authenticate(request)?.id).toBe(registration.user.id);
  });

  it("uses the generated user ID as the login identity", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-auth-id-login-"));
    const auth = new InternalAuthStore("id-login-key", rootDir);
    const registration = await auth.register("只记 ID", "test-pass-1", "id-login-key", "test-client");
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;
    expect(registration.user.id).toMatch(/^u-[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    const login = auth.login(registration.user.id, "test-pass-1", "test-client");
    expect(login?.user.id).toBe(registration.user.id);
  });

  it("delegates clinician report structure to the writing skill independently of thinking level", () => {
    const low = buildAgentPrompt(promptInput({ thinkingLevel: "low" }));
    const maximum = buildAgentPrompt(promptInput({ thinkingLevel: "high" }));
    const publicPrompt = buildAgentPrompt(promptInput({ audienceMode: "public", retrievalPolicy: "mcp_only" }));
    for (const prompt of [low, maximum, publicPrompt]) {
      expect(prompt).toContain("在最终回复前调用 report_write")
      expect(prompt).toContain("不得只在聊天消息中输出摘要")
      expect(prompt).toContain("clinical-report-writing skill")
      expect(prompt).toContain("调用 report_write 前自检")
      expect(prompt).toContain("只有研究目标、临床判断或面向医生的阶段发生实质变化时才说明进展")
      expect(prompt).toContain("原文定位、登记证据和可自动恢复的工具重试")
      expect(prompt).not.toContain("完整呈现 PICO")
      expect(prompt).not.toContain("保留 PICO")
      expect(prompt).not.toContain("临床场景概述、循证问题、证据基础与证据状态")
      expect(prompt).not.toContain("必须使用独立的二级或三级标题")
      expect(prompt).toContain("专家模式策略")
      expect(prompt).toContain("不要求完整 PICO")
      expect(prompt).toContain("患者价值观")
    }
    expect(publicPrompt).toContain("read、bash 等本地工具仍可用于读取和定位本会话已归档内容")
    expect(publicPrompt).toContain("不使用 PubMed、公共网页或本地来源库检索")
    expect(low).not.toContain("最少必要")
    expect(maximum).not.toContain("指南推荐等级")
    expect(publicPrompt).toContain("面向临床人员")
    expect(publicPrompt).toContain("本轮外部临床知识检索仅使用指南库")
    expect(low).toContain("每个新的临床子问题先调用 source_library_search")
    expect(low).toContain("所有可见的工具调用前说明")
    expect(low).toContain("thinking_level=off")
  });

  it("keeps the evidence toolchain available when a legacy client sends search_enabled=false", () => {
    const prompt = buildAgentPrompt(promptInput({ searchEnabled: false }));
    expect(prompt).toContain("source_library_search")
    expect(prompt).toContain("可按需使用已配置的检索工具")
    expect(prompt).not.toContain("只使用当前会话中的既有材料")
  });

  it("keeps follow-up QA on the direct-answer path instead of forcing report tools", () => {
    const prompt = buildAgentPrompt(promptInput({ responseMode: "answer" }));
    expect(prompt).toContain("只需完成对话式回答")
    expect(prompt).toContain("不要为了回答追问而重复执行正式报告流程")
    expect(prompt).not.toContain("在最终回复前调用 report_write")
    expect(prompt).not.toContain("必须生成正式循证报告")
  });

  it("builds a direct, evidence-backed fast-mode answer prompt", () => {
    const prompt = buildAgentPrompt(promptInput({ researchMode: "quick", thinkingLevel: "low", responseMode: "answer", maxIterations: 8 }));
    expect(prompt).toContain("一批并发调用");
    expect(prompt).toContain("循证问题");
    expect(prompt).toContain("不要把分析写成无限制的碎片化要点");
    expect(prompt).toContain("不要调用 evidence_add、report_write、report_finalize");
    expect(prompt).toContain("<ref source_ids=");
    expect(prompt).toContain("自动生成参考文献");
    expect(prompt).toContain("完整 EBM 五步法");
    expect(prompt).toContain("绝不要求完整 PICO");
    expect(prompt).toContain("严格区分直接证据与间接证据");
    expect(prompt).toContain("第一次接触这个问题的人");
    expect(prompt).toContain("不要用‘循证问题’、‘问题界定’、‘核心结论’作标题");
    expect(prompt).toContain("默认不用表格");
    expect(prompt).toContain("当前要决定什么 → 已读证据直接说明什么");
    expect(prompt).toContain("绝不可把 read_id（如 r05）");
    expect(prompt).toContain("每批最多 8 个");
    expect(prompt).toContain("第 8 个研究轮次");
    expect(prompt).not.toContain("clinical-report-writing skill");
  });

  it("turns one or more quick-mode source IDs into numbered references without evidence records", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-quick-references-"));
    const guideline = await archiveSource({
      sessionDir, kind: "read", title: "Clinical guideline 2026", sourceInstitution: "Example Society",
      sourceUrl: "https://example.test/guideline", content: "Use the recommended treatment when eligible.",
    });
    const review = await archiveSource({
      sessionDir, kind: "read", title: "Systematic review 2025",
      sourceUrl: "https://example.test/review", content: "The intervention improves the relevant outcome.",
    });

    const answer = await formatQuickAnswerReferences(
      sessionDir,
      `The treatment is conditionally appropriate <ref source_ids="${guideline.sourceId},${review.sourceId}" />.\n\nA second claim uses the guideline <ref source_ids="${guideline.sourceId}" />.`,
    );

    expect(answer).toContain("conditionally appropriate [1,2]");
    expect(answer).toContain("guideline [1]");
    expect(answer).toContain("## 参考文献");
    expect(answer).toContain("1. Example Society. Clinical guideline 2026. https://example.test/guideline");
    expect(answer).toContain("Systematic review 2025. https://example.test/review");
    expect(answer).not.toContain("1. [1]");
    expect(answer).not.toContain("<ref source_ids");
  });

  it("uses the archived document heading when a reader supplied an abstract label as the title", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-quick-citation-title-"));
    const source = await archiveSource({
      sessionDir,
      kind: "read",
      title: "**METHODS:** This is an abstract sentence rather than an article title.",
      sourceUrl: "https://example.test/article",
      content: "# Correct clinical article title\n\nAbstract text.",
    });

    const answer = await formatQuickAnswerReferences(sessionDir, `A supported claim <ref source_ids="${source.sourceId}" />.`);

    expect(answer).toContain("Correct clinical article title. https://example.test/article");
    expect(answer).not.toContain("**METHODS:**");
  });

  it("uses an embedded document title instead of a decorative image heading", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-quick-citation-image-title-"));
    const source = await archiveSource({
      sessionDir,
      kind: "read",
      sourceUrl: "https://example.test/thyroid",
      content: "Title: 甲状腺功能亢进症诊治指南解读\n\n# ![Journal logo](https://example.test/logo.png)\n\nClinical content.",
    });

    const answer = await formatQuickAnswerReferences(sessionDir, `A supported claim <ref source_ids="${source.sourceId}" />.`);

    expect(answer).toContain("甲状腺功能亢进症诊治指南解读. https://example.test/thyroid");
    expect(answer).not.toContain("![Journal logo]");
  });

  it("recovers a read receipt mistakenly used in a quick citation marker", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-quick-read-id-reference-"));
    const source = await archiveSource({
      sessionDir, kind: "read", title: "Read receipt source", sourceUrl: "https://example.test/read", content: "Direct supporting evidence.",
    });
    const markdown = await readFile(path.join(sessionDir, source.path), "utf8");
    const receipt = await registerReadReceipt({
      sessionDir, sourcePath: source.path, source: markdown, lineStart: source.bodyLineStart, lineEnd: source.bodyLineStart,
    });

    const answer = await formatQuickAnswerReferences(sessionDir, `A supported claim <ref source_ids="${receipt.id}" />.`);

    expect(answer).toContain("A supported claim [1].");
    expect(answer).toContain("Read receipt source. https://example.test/read");
  });

  it("removes a model-written bold reference section before appending the generated bibliography", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-quick-manual-references-"));
    const source = await archiveSource({
      sessionDir, kind: "read", title: "Direct source", sourceUrl: "https://example.test/direct", content: "Direct supporting evidence.",
    });

    const answer = await formatQuickAnswerReferences(
      sessionDir,
      `Conclusion <ref source_ids="${source.sourceId}" />.\n\n**参考文献**\n- A model-written duplicate [1]`,
    );

    expect(answer.match(/参考文献/g)).toHaveLength(1);
    expect(answer).not.toContain("model-written duplicate");
    expect(answer).toContain("1. Direct source. https://example.test/direct");
  });

  it("returns verified source excerpts for a numbered report citation without exposing evidence IDs", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-citation-api-"));
    const sessionId = "citation-session";
    const workspaceName = "citation-workspace";
    const workspace = path.join(rootDir, "data", "sessions", workspaceName);
    await mkdir(path.join(rootDir, "data", "sessions", ".metadata", "workspaces"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(path.join(workspace, ".metadata"), { recursive: true });
    await writeFile(path.join(workspace, ".metadata", "session.json"), JSON.stringify({ sessionId, directory: workspaceName }), "utf8");
    await writeFile(
      path.join(rootDir, "data", "sessions", ".metadata", "workspaces", `${sessionId}.json`),
      JSON.stringify({ directory: workspaceName }),
      "utf8",
    );
    const source = await archiveSource({
      sessionDir: workspace,
      kind: "read",
      title: "Randomized trial",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      content: "# Trial\n\nThe intervention reduced recurrence without increasing severe bleeding.",
    });
    const evidence = await addEvidence({
      sessionDir: workspace,
      question: "Does treatment reduce recurrence?",
      claim: "Treatment reduced recurrence.",
      relation: "supports",
      provenance: "primary_abstract",
      confidence: "high",
      sourcePath: source.path,
      quote: "The intervention reduced recurrence without increasing severe bleeding.",
    });
    const mcpSource = await archiveSource({
      sessionDir: workspace,
      kind: "read",
      title: "Chinese clinical guideline",
      sourceUrl: "mcp://guideline/cma_2026_example",
      sourceInstitution: "Chinese Medical Association",
      content: "# Guideline\n\nThe guideline recommends treatment for eligible patients.",
    });
    const mcpEvidence = await addEvidence({
      sessionDir: workspace,
      question: "Does the guideline recommend treatment?",
      claim: "The guideline recommends treatment.",
      relation: "supports",
      provenance: "guideline_official",
      confidence: "high",
      sourcePath: mcpSource.path,
      quote: "The guideline recommends treatment for eligible patients.",
    });
    const report = await writeReport({
      sessionDir: workspace,
      title: "Citation details",
      content: "# Conclusion\n\nTreatment reduced recurrence [1]. The guideline recommends treatment [2].",
      references: [
        { number: 1, citation: "Randomized trial. PMID 12345678.", evidenceId: evidence.id },
        { number: 2, citation: "Chinese clinical guideline.", evidenceId: mcpEvidence.id },
      ],
    });
    const executor: AgentExecutor = async () => ({ message: "unused" });
    const { api, baseUrl } = await startApi(executor, undefined, rootDir);
    try {
      const response = await fetch(`${baseUrl}/api/v1/research-sessions/${sessionId}/citations?report_path=${encodeURIComponent(report.path)}&number=1`);
      const payload = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        number: 1,
        citation: "Randomized trial. PMID 12345678.",
        evidence: [{
          claim: "Treatment reduced recurrence.",
          quote: "The intervention reduced recurrence without increasing severe bleeding.",
          verified: true,
          source: {
            title: "Randomized trial",
            url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
          },
        }],
      });
      expect(JSON.stringify(payload)).not.toContain(evidence.id);

      const mcpResponse = await fetch(`${baseUrl}/api/v1/research-sessions/${sessionId}/citations?report_path=${encodeURIComponent(report.path)}&number=2`);
      const mcpPayload = await mcpResponse.json() as { evidence: Array<{ source: Record<string, string> }> };
      expect(mcpResponse.status).toBe(200);
      expect(mcpPayload.evidence[0]!.source).toMatchObject({
        title: "Chinese clinical guideline",
        institution: "Chinese Medical Association",
        url: "",
      });

      const outside = await mkdtemp(path.join(os.tmpdir(), "ebm-citation-outside-"));
      const secret = path.join(outside, "secret.md");
      await writeFile(secret, "must not be served", "utf8");
      await symlink(secret, path.join(workspace, "reports", "leaked.md"));
      const escapedFileResponse = await fetch(
        `${baseUrl}/api/v1/research-sessions/${sessionId}/files?path=${encodeURIComponent("reports/leaked.md")}`,
      );
      expect(escapedFileResponse.status).toBe(404);

      await writeFile(path.join(workspace, source.path), "# Trial\n\nThe archived source was changed after report generation.", "utf8");
      const invalidResponse = await fetch(`${baseUrl}/api/v1/research-sessions/${sessionId}/citations?report_path=${encodeURIComponent(report.path)}&number=1`);
      const invalidPayload = await invalidResponse.json() as { error: { code: string } };
      expect(invalidResponse.status).toBe(409);
      expect(invalidPayload.error.code).toBe("citation_evidence_unavailable");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("creates an async run and exposes the completed normalized response", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const executor: AgentExecutor = async (input, hooks) => {
      receivedInput = input;
      hooks.setSessionId("pi-session-1");
      hooks.onTrace({ kind: "tool.completed", label: "PubMed", timestamp: new Date().toISOString() });
      hooks.onProgress({ text: "正在核对最新治疗建议。", timestamp: new Date().toISOString() });
      hooks.onTool({ id: "tool-1", name: "pubmed_search", status: "running" });
      hooks.onTool({ id: "tool-1", name: "pubmed_search", status: "completed", result: "已找到候选文献。" });
      return { message: "这是可追溯的循证回答。", reportMarkdown: "# 完整循证报告\n\n正文。" };
    };
    const { api, baseUrl } = await startApi(executor);
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "类风湿关节炎患者该如何升级治疗？", thinking_level: "high" }),
      });
      expect(created.status).toBe(202);
      const accepted = await created.json() as { run_id: string; status: string; contract_version: string };
      expect(accepted.contract_version).toBe("xunyi-research/v1");
      expect(accepted.status).toBe("queued");

      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(result).toMatchObject({ status: "succeeded", stage: "idle", session_id: "pi-session-1", message: "这是可追溯的循证回答。" });
      expect(result.report_markdown).toContain("完整循证报告");
      expect(result.summary.request_timeout_seconds).toBe(3600);
      expect(result.summary.retrieval_policy).toBe("all");
      expect(result.summary.thinking_level).toBe("high");
      expect(receivedInput?.thinkingLevel).toBe("high");
      expect(receivedInput?.retrievalPolicy).toBe("all");
      expect(result.agent_trace.some((event: { kind: string }) => event.kind === "tool.completed")).toBe(true);
      expect(result.progress_updates).toEqual([expect.objectContaining({ text: "正在核对最新治疗建议。" })]);
      expect(result.tools).toEqual([{ id: "tool-1", name: "pubmed_search", status: "completed", result: "已找到候选文献。" }]);
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("uses server-owned quick limits and preserves expert thinking selection", async () => {
    const received: AgentRunInput[] = [];
    const { api, baseUrl } = await startApi(async (input) => { received.push(input); return { message: "done" }; });
    const runsUrl = baseUrl + "/api/v1/agent-runs";
    try {
      const quick = await fetch(runsUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "quick mode test", research_mode: "quick", thinking_level: "high" }),
      });
      const quickAccepted = await quick.json() as { run_id: string };
      const quickResult = await eventually(
        async () => (await fetch(runsUrl + "/" + quickAccepted.run_id)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(received[0]).toMatchObject({ researchMode: "quick", thinkingLevel: "low", responseMode: "answer", maxIterations: 8, requestTimeoutSeconds: 600 });
      expect(quickResult.summary).toMatchObject({ research_mode: "quick", thinking_level: "low", response_mode: "answer" });

      const expert = await fetch(runsUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "expert mode test", research_mode: "expert", thinking_level: "medium" }),
      });
      const expertAccepted = await expert.json() as { run_id: string };
      await eventually(
        async () => (await fetch(runsUrl + "/" + expertAccepted.run_id)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(received[1]).toMatchObject({ researchMode: "expert", thinkingLevel: "medium", responseMode: "report", maxIterations: 48, requestTimeoutSeconds: 3600 });
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("classifies malformed route encoding as a client error", async () => {
    const { api, baseUrl } = await startApi(async () => ({ message: "unused" }));
    try {
      const response = await fetch(`${baseUrl}/api/v1/agent-runs/%`);
      const payload = await response.json() as Record<string, unknown>;
      expect(response.status).toBe(400);
      expect(payload).toMatchObject({
        ok: false,
        error: { code: "invalid_path_encoding" },
      });
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("does not serve static files through symlinks outside the configured directory", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-static-api-"));
    const staticDir = path.join(rootDir, "public");
    const outside = await mkdtemp(path.join(os.tmpdir(), "ebm-static-outside-"));
    await mkdir(staticDir, { recursive: true });
    await writeFile(path.join(staticDir, "index.html"), "<main>safe</main>", "utf8");
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "must not be served", "utf8");
    await symlink(secret, path.join(staticDir, "leaked.txt"));

    const { api } = await startApi(async () => ({ message: "unused" }), undefined, rootDir, staticDir);
    const address = api.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
    try {
      const safe = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(safe.status).toBe(200);
      const escaped = await fetch(`http://127.0.0.1:${address.port}/leaked.txt`);
      expect(escaped.status).toBe(404);
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("redacts credential-shaped diagnostics before returning an executor failure", async () => {
    const executor: AgentExecutor = async () => {
      throw new Error("provider failed: Authorization: Bearer RPC_TEST_SENTINEL");
    };
    const { api, baseUrl } = await startApi(executor);
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "这是一个用于错误边界测试的临床问题。" }),
      });
      const accepted = await created.json() as { run_id: string };
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "failed",
      );
      expect(JSON.stringify(result)).not.toContain("RPC_TEST_SENTINEL");
      expect(result.error?.message).toContain("[redacted]");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("keeps the reserved audience field separate from the research retrieval policy", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const { api, baseUrl } = await startApi(async (input) => {
      receivedInput = input;
      return { message: "完成。" };
    });
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "患者端问题", audience_mode: "public", retrieval_policy: "all" }),
      });
      const accepted = await created.json() as { run_id: string };
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput?.audienceMode).toBe("public");
      expect(receivedInput?.retrievalPolicy).toBe("all");
      expect(result.summary).toMatchObject({ audience_mode: "public", retrieval_policy: "all" });
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("runs patient preparation through its own no-tool executor contract", async () => {
    let received: PatientIntakeInput | undefined;
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "ebm-patient-api-"));
    const runtimeConfig: RuntimeConfig = {
      default_provider: "deepseek", default_model: "deepseek-v4-flash",
      models: [{ provider: "deepseek", provider_label: "DeepSeek", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: true }],
    };
    const patientApi = createAgentApiServer({
      executor: async () => ({ message: "研究完成。" }),
      rootDir,
      runtimeConfig,
      patientIntakeExecutor: async (input) => {
        received = input;
        return { sessionId: input.sessionId || "patient-session-1", reply: input.intent === "summary"
          ? "## 此次就诊想解决什么\n\n睡眠问题\n\n## 发生经过\n\n两周\n\n## 目前的感受与影响\n\n尚未说明\n\n## 已有检查、用药和相关情况\n\n尚未说明\n\n## 我想请医生帮助回答\n\n如何改善\n\n## 还没说清楚的地方\n\n尚未说明"
          : "我明白了。" };
      },
    });
    patientApi.server.listen(0, "127.0.0.1");
    await once(patientApi.server, "listening");
    const address = patientApi.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
    const patientUrl = `http://127.0.0.1:${address.port}`;
    const body = {
      client_session_id: "visit-1", mode: "visit_preparation", thinking_enabled: true,
      profile: { id: "profile-1", revision: "2026-08-01T12:00:00.000Z", name: "我", sex: "unspecified", allergies: "", pregnancy: "not_applicable", memory: "" },
    };
    try {
      const reply = await fetch(`${patientUrl}/api/v1/patient-intake/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, message: "最近总是睡不好" }),
      });
      expect(reply.status).toBe(200);
      expect(await reply.json()).toMatchObject({ contract_version: "xunyi-patient/v1", session_id: "visit-1", reply: "我明白了。" });
      expect(received).toMatchObject({ message: "最近总是睡不好", intent: "conversation" });
      const summary = await fetch(`${patientUrl}/api/v1/patient-intake/summary`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, message: "请整理本次就诊说明" }),
      });
      expect(summary.status).toBe(200);
      expect(received).toMatchObject({ sessionId: "patient-session-1", intent: "summary" });
      const archived = await summary.json() as { report_path: string };
      expect(archived.report_path).toContain("reports/report-001.md");
      expect(await readFile(path.join(rootDir, archived.report_path), "utf8")).toContain("睡眠问题");
    } finally {
      patientApi.server.close();
      await once(patientApi.server, "close");
    }
  });

  it("keeps patient preparation prompt focused on expression rather than diagnosis or retrieval", () => {
    const input: PatientIntakeInput = {
      message: "胸口有些不舒服", clientSessionId: "visit-1", intent: "conversation", mode: "visit_preparation",
      thinkingEnabled: true, profile: { id: "profile-1", revision: "r1", name: "我", sex: "unspecified", allergies: "", pregnancy: "not_applicable", memory: "" },
      provider: "deepseek", model: "deepseek-v4-flash",
    };
    const prompt = buildPatientIntakePrompt(input);
    expect(prompt).toBe("胸口有些不舒服");
    expect(buildPatientIntakePrompt({ ...input, message: "ignored", intent: "summary" })).toContain("用户明确提供的信息");
  });

  it.each(["off", "low", "medium", "high"] as const)("passes Pi thinking level %s through without a research-mode mapping", async (thinkingLevel) => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const { api, baseUrl } = await startApi(async (input) => {
      receivedInput = input;
      return { message: "完成。" };
    });
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "测试直接传递推理强度", thinking_level: thinkingLevel }),
      });
      const accepted = await created.json() as { run_id: string };
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput?.thinkingLevel).toBe(thinkingLevel);
      expect(result.summary.thinking_level).toBe(thinkingLevel);
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("publishes server-configured models and sends the selected model to the executor", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const runtimeConfig: RuntimeConfig = {
      default_provider: "xinqiong",
      default_model: "deepseek-v4-flash",
      models: [
        { provider: "xinqiong", provider_label: "芯穹", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: true },
        { provider: "deepseek", provider_label: "DeepSeek", model: "deepseek-v4-flash", model_label: "DeepSeek V4 Flash", available: false },
      ],
    };
    const { api, baseUrl } = await startApi(async (input) => {
      receivedInput = input;
      return { message: "完成。" };
    }, runtimeConfig);
    try {
      const config = await fetch(`${baseUrl}/api/v1/runtime-config`);
      const published = await config.json() as RuntimeConfig;
      expect(published.default_provider).toBe("xinqiong");
      expect(published.models.find((item) => item.provider === "xinqiong")).toMatchObject({ available: true });
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请检索一个临床问题", provider: "xinqiong", model: "deepseek-v4-flash" }),
      });
      const accepted = await created.json() as { run_id: string };
      await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput).toMatchObject({ provider: "xinqiong", model: "deepseek-v4-flash" });
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("forwards a known research session so follow-up questions keep their evidence context", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const { api, baseUrl } = await startApi(async (input) => {
      receivedInput = input;
      return {
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        message: "已沿用既有研究上下文。",
      };
    });
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请基于上次报告补充长期随访建议", session_id: "pi-session-follow-up" }),
      });
      const accepted = await created.json() as { run_id: string };
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput?.sessionId).toBe("pi-session-follow-up");
      expect(result.session_id).toBe("pi-session-follow-up");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("accepts the isolated MCP-only retrieval policy", async () => {
    let receivedInput: Parameters<AgentExecutor>[0] | undefined;
    const executor: AgentExecutor = async (input) => {
      receivedInput = input;
      return { message: "仅使用 MCP 完成。" };
    };
    const { api, baseUrl } = await startApi(executor);
    try {
      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请仅通过指南 MCP 回答测试问题", retrieval_policy: "mcp_only" }),
      });
      const accepted = await created.json() as { run_id: string };
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "succeeded",
      );
      expect(receivedInput?.retrievalPolicy).toBe("mcp_only");
      expect(result.summary.retrieval_policy).toBe("mcp_only");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });

  it("cancels a running job and validates attachment IDs explicitly", async () => {
    const executor: AgentExecutor = async (_input, hooks) => new Promise((_resolve, reject) => {
      if (hooks.signal.aborted) {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
        return;
      }
      hooks.signal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
    const { api, baseUrl } = await startApi(executor);
    try {
      const unsupported = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "带附件的问题", attachments: [{ name: "paper.pdf" }] }),
      });
      expect(unsupported.status).toBe(422);
      expect(await unsupported.json()).toMatchObject({ error: { code: "invalid_attachment" } });

      const created = await fetch(`${baseUrl}/api/v1/agent-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "请开始一个可取消任务" }),
      });
      const accepted = await created.json() as { run_id: string };
      const cancelled = await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}/cancel`, { method: "POST" });
      expect(cancelled.status).toBe(202);
      const result = await eventually(
        async () => (await fetch(`${baseUrl}/api/v1/agent-runs/${accepted.run_id}`)).json() as Promise<TestRunResponse>,
        (value) => value.status === "cancelled",
      );
      expect(result.message).toContain("中断");
    } finally {
      api.server.close();
      await once(api.server, "close");
    }
  });
});
