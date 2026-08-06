import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { registerEbmTools } from "../src/extensions/ebmTools.js";
import { archiveSource } from "../src/tools/archive.js";
import { renderGuidelineReadText, renderRetrieveCards } from "../src/extensions/guidelineTools.js";
import { renderAbstractNavigation } from "../src/extensions/pubmedTools.js";
import { initializePiSessionDirectory, piReadableSessionPath } from "../src/extensions/sessionPath.js";

describe("EBM Pi extension tools", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps report guidance concise and judgment-led", () => {
    const tools = new Map<string, { promptGuidelines?: string[] }>();
    vi.stubEnv("GUIDELINE_MCP_URL", "");
    registerEbmTools({
      registerTool: (tool: { name: string; promptGuidelines?: string[] }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);

    const writeGuidance = tools.get("report_write")?.promptGuidelines?.join("\n") ?? "";
    const finalizeGuidance = tools.get("report_finalize")?.promptGuidelines?.join("\n") ?? "";
    expect(writeGuidance).toContain("保留未知事实");
    expect(writeGuidance).toContain("不要为了满足关键词或固定模板扩展检索");
    expect(writeGuidance).toContain("文章质量、摘要范围和 PDF 排版由模型结合上下文判断");
    expect(finalizeGuidance).toContain("普通成功的 report_write 不需要再次调用它");
  });

  it("exposes read-id or line-range anchor locators", () => {
    const tools = new Map<string, { parameters?: { properties?: Record<string, { pattern?: string }>; required?: string[] }; promptGuidelines?: string[] }>();
    vi.stubEnv("GUIDELINE_MCP_URL", "");
    registerEbmTools({
      registerTool: (tool: { name: string; parameters?: { properties?: Record<string, { pattern?: string }>; required?: string[] }; promptGuidelines?: string[] }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);

    const schema = tools.get("evidence_add")?.parameters;
    expect(schema?.properties).toHaveProperty("source_path");
    expect(schema?.properties).toHaveProperty("read_id");
    expect(schema?.properties).toHaveProperty("line_start");
    expect(schema?.properties).toHaveProperty("line_end");
    expect(schema?.properties).toHaveProperty("start_text");
    expect(schema?.properties).toHaveProperty("end_text");
    expect(schema?.properties).not.toHaveProperty("quote");
    expect(schema?.properties).not.toHaveProperty("source_span_id");
    expect(schema?.required ?? []).not.toContain("source_path");
    expect(schema?.required ?? []).not.toContain("start_text");
    expect(schema?.required ?? []).not.toContain("end_text");
    expect(tools.get("evidence_add")?.promptGuidelines?.join("\n")).toContain("Choose one locator mode");
    expect(tools.get("evidence_add")?.promptGuidelines?.join("\n")).toContain("do not accept a whole-read fallback");
    expect(schema?.properties).not.toHaveProperty("source_id");
  });

  it("returns evidence-ready PubMed abstract paths with a canonical quote instruction", () => {
    const output = renderAbstractNavigation("session-1", [{
      path: "sources/read/trial/full.md",
      title: "Trial",
      bodyLineStart: 8,
      content: "# Trial\n\n## Abstract\n\nResult line one.\nResult line two.\n\n## PubMed context\n\nNavigation/context only.\nDOI: 10.1000/test\n",
    }] as never);
    expect(output).toContain("PMID: unknown");
    expect(output).toContain("Abstract preview: Result line one. Result line two.");
    expect(output).toContain("Readable abstract path: data/sessions/session-1/sources/read/trial/full.md");
    expect(output).toContain("choose read_id with the shortest distinctive continuous start_text/end_text (semantic completeness is unnecessary)");
    expect(output).not.toContain("Navigation/context only");
    expect(output).not.toContain("10.1000/test");
    expect(output).not.toContain("Evidence source_path:");
    expect(output).not.toContain("Source map");
    expect(output).not.toContain("Read any archive window");
  });

  it("returns search snapshot guidance when PubMed search finds no citation-capable abstracts", () => {
    const output = renderAbstractNavigation("session-1", [], { searchArchivePath: "sources/search/query.md", pmids: ["1", "2"] });
    expect(output).toContain("No complete PubMed abstracts were archived");
    expect(output).toContain("PubMed returned 2 PMID(s): 1, 2");
    expect(output).toContain("pubmed_read");
    expect(output).toContain("Readable search snapshot: data/sessions/session-1/sources/search/query.md");
    expect(output).toContain("discovery history only");
  });

  it("renders guideline MCP reads from informative sections instead of front matter", () => {
    const text = renderGuidelineReadText("data/sessions/s1/sources/read/guideline/full.md", {
      bodyLineStart: 1,
      lines: 15,
      tocPath: "sources/read/guideline/toc.md",
      content: [
        "# Guideline",
        "1219416 ESO0010 journal metadata",
        "## Joanna M Wardlaw1,*",
        "## Abstract",
        "A noisy abstract start.",
        "## Evidence-based Recommendation 1",
        "We recommend intravenous alteplase for eligible patients.",
        "## References",
      ].join("\n"),
    });
    expect(text).toContain("Readable guideline path: data/sessions/s1/sources/read/guideline/full.md");
    expect(text).toContain("Best-effort navigation index");
    expect(text).toContain("## Abstract");
    expect(text).toContain("## Evidence-based Recommendation 1");
    expect(text).toContain("We recommend intravenous alteplase");
    expect(text).not.toContain("Joanna M Wardlaw");
  });

  it("labels guideline search as document discovery rather than evidence", () => {
    const tools = new Map<string, { description?: string; promptGuidelines?: string[] }>();
    vi.stubEnv("GUIDELINE_MCP_URL", "https://guideline.example.test");
    registerEbmTools({
      registerTool: (tool: { name: string; description?: string; promptGuidelines?: string[] }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);
    const search = tools.get("guideline_mcp_search");
    const retrieve = tools.get("guideline_mcp_retrieve");
    expect(search?.description).toContain("document-level candidates");
    expect(search?.description).toContain("does not return citation-ready evidence");
    expect(search?.promptGuidelines?.join(" ")).toContain("document candidates only");
    expect(retrieve?.description).toContain("citation-capable quote source");
  });

  it("renders copy-ready verbatim material without asking the model to calculate line ranges", () => {
    const text = renderRetrieveCards("Candidates", [{
      title: "Hypertension guideline",
      sourcePath: "sources/read/hypertension.md",
      lineStart: 21,
      lineEnd: 24,
      candidateMaterial: "Recommendation text.",
    }], (sourcePath) => `data/sessions/s1/${sourcePath}`);

    expect(text).toContain("readable chunk path: data/sessions/s1/sources/read/hypertension.md");
    expect(text).toContain("candidate material (identical to archived body):");
    expect(text).toContain("candidate materials, not evidence yet");
    expect(text).toContain("choose read_id plus start_text/end_text (source_path optional)");
    expect(text).not.toContain("offset:");
    expect(text).not.toContain("limit:");
  });

  it("loads the project extension through Pi's resource loader", async () => {
    const cwd = process.cwd();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: path.join(cwd, ".test-pi-agent"),
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [path.join(cwd, ".pi", "extensions", "ebm-tools.ts")],
    });
    await loader.reload();

    expect(loader.getExtensions().errors).toEqual([]);
    expect(loader.getExtensions().extensions.map((extension) => extension.path)).toContain(
      path.join(cwd, ".pi", "extensions", "ebm-tools.ts"),
    );
    expect(loader.getSkills().diagnostics).toEqual([]);
    expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(expect.arrayContaining([
      "clinical-report-writing",
      "ebm-research",
    ]));
  });

  it("does not expose a private guideline tool when no MCP endpoint is configured", () => {
    vi.stubEnv("GUIDELINE_MCP_URL", "");
    const names: string[] = [];
    registerEbmTools({
      registerTool: (tool: { name: string }) => names.push(tool.name),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);
    expect(names).not.toContain("guideline_mcp_search");
    expect(names).not.toContain("guideline_mcp_retrieve");
    expect(names).not.toContain("guideline_mcp_read");
  });

  it("returns readable session workspace paths from report_write", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    vi.stubEnv("GUIDELINE_MCP_URL", "");
    registerEbmTools({
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);

    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-pi-tools-"));
    const sessionId = "session-1";
    const sessionDir = await initializePiSessionDirectory(cwd, sessionId, { sessionName: "Mortality report", firstPrompt: "Does it work?" });
    await mkdir(path.join(sessionDir, "sources", "read"), { recursive: true });
    await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "header\nexact evidence", "utf8");
    const ctx = { cwd, sessionManager: { getSessionId: () => sessionId } };
    const evidence = await tools.get("evidence_add")!.execute("call-1", {
      question: "Does it work?",
      claim: "It works.",
      relation: "supports",
      source_path: piReadableSessionPath(cwd, sessionId, "sources/read/study.md"),
      line_start: 1,
      line_end: 2,
      start_text: "exact",
      end_text: "evidence",
    }, undefined, undefined, ctx);

    const report = await tools.get("report_write")!.execute("call-2", {
      title: "Mortality report",
      markdown: "# Conclusion\n\nIt works [1].",
      references: [{ number: 1, citation: "Study citation.", evidence_id: evidence.details.evidenceId }],
    }, undefined, undefined, ctx);

    const workspace = `data/sessions/${path.basename(sessionDir)}`;
    expect(report.content[0].text).toContain(`会话工作区：${workspace}`);
    expect(report.content[0].text).toContain(`已写入并核验正式报告：${workspace}/reports/mortality-report.md`);
    expect(report.details).toMatchObject({ readablePath: `${workspace}/reports/mortality-report.md`, sessionWorkspace: workspace });
  });

  it("registers evidence with a required source path and exact anchors", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    vi.stubEnv("GUIDELINE_MCP_URL", "");
    registerEbmTools({
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-pi-tools-"));
    const sessionId = "session-1";
    const sessionDir = await initializePiSessionDirectory(cwd, sessionId, { sessionName: "Source identity", firstPrompt: "Does it work?" });
    const archive = await archiveSource({ sessionDir, kind: "read", title: "Stable study", sourceUrl: "https://example.test/study", content: "A stable exact finding." });
    const ctx = { cwd, sessionManager: { getSessionId: () => sessionId } };

    const evidence = await tools.get("evidence_add")!.execute("call-source-id", {
      question: "Does it work?",
      claim: "The finding is stable.",
      relation: "supports",
      source_path: archive.path,
      line_start: archive.bodyLineStart,
      line_end: archive.bodyLineStart + archive.lines - 1,
      start_text: "A stable exact",
      end_text: "finding.",
    }, undefined, undefined, ctx);

    expect(evidence.details.node).toMatchObject({ sourceId: archive.sourceId, documentId: archive.documentId, sourcePath: archive.path });
  });

  it("rejects anchors outside the declared line range", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    vi.stubEnv("GUIDELINE_MCP_URL", "");
    registerEbmTools({
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: () => undefined },
    } as never);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-pi-tools-"));
    const sessionId = "session-1";
    const sessionDir = await initializePiSessionDirectory(cwd, sessionId, { sessionName: "Quote recovery", firstPrompt: "What is the bleeding risk?" });
    await mkdir(path.join(sessionDir, "sources", "read"), { recursive: true });
    await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "严重出血年绝对增加率不超过 0.3%，低于卒中风险降低幅度。", "utf8");
    const ctx = { cwd, sessionManager: { getSessionId: () => sessionId } };

    await expect(tools.get("evidence_add")!.execute("call-1", {
      question: "What is the bleeding tradeoff?",
      claim: "The bleeding increase is smaller than the stroke reduction.",
      relation: "supports",
      source_path: piReadableSessionPath(cwd, sessionId, "sources/read/study.md"),
      line_start: 2,
      line_end: 2,
      start_text: "严重出血年",
      end_text: "卒中风险降低幅度。",
    }, undefined, undefined, ctx)).rejects.toThrow(/line_start/);
  });

  it("saves a failed report draft and finalizes it after local edit", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    const events: Array<[string, unknown]> = [];
    registerEbmTools({
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => tools.set(tool.name, tool),
      on: () => undefined,
      events: { emit: (name: string, payload: unknown) => events.push([name, payload]) },
    } as never);

    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-pi-tools-"));
    const sessionId = "session-1";
    const sessionDir = await initializePiSessionDirectory(cwd, sessionId, { sessionName: "Draft finalize", firstPrompt: "Does it work?" });
    await mkdir(path.join(sessionDir, "sources", "read"), { recursive: true });
    await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "mortality improved\nadverse events improved", "utf8");
    const ctx = { cwd, sessionManager: { getSessionId: () => sessionId } };
    const ev1 = await tools.get("evidence_add")!.execute("call-1", {
      question: "Does it work?",
      claim: "Mortality improved.",
      relation: "supports",
      source_path: piReadableSessionPath(cwd, sessionId, "sources/read/study.md"),
      line_start: 1,
      line_end: 1,
      start_text: "mortality",
      end_text: "improved",
    }, undefined, undefined, ctx);
    const ev2 = await tools.get("evidence_add")!.execute("call-2", {
      question: "Does it work?",
      claim: "Adverse events improved.",
      relation: "supports",
      source_path: piReadableSessionPath(cwd, sessionId, "sources/read/study.md"),
      line_start: 2,
      line_end: 2,
      start_text: "adverse",
      end_text: "improved",
    }, undefined, undefined, ctx);

    const failed = await tools.get("report_write")!.execute("call-3", {
      title: "Draft finalize report",
      markdown: "# Conclusion\n\nTreatment works but citation is missing.",
      references: [
        { number: 1, citation: "Study citation.", evidence_id: ev1.details.evidenceId },
        { number: 1, citation: "Study citation.", evidence_id: ev2.details.evidenceId },
      ],
    }, undefined, undefined, ctx);
    expect(failed.content[0].text).toContain("报告核验失败");
    expect(failed.isError).toBe(true);
    expect(failed.details.verified).toBe(false);
    expect(failed.details.draft.path).toBe("reports/drafts/draft-finalize-report.draft.md");

    const draftAbs = path.join(sessionDir, failed.details.draft.path);
    const draft = await readFile(draftAbs, "utf8");
    expect(draft).toContain("这里只是草稿预览");
    await writeFile(draftAbs, draft.replace("Treatment works but citation is missing.", "Treatment works for mortality and adverse events [1]."), "utf8");

    const finalized = await tools.get("report_finalize")!.execute("call-4", {
      draft_path: failed.details.draft.path,
      title: "Draft finalize report",
      references: [
        { number: 1, citation: "Study citation.", evidence_id: ev1.details.evidenceId },
        { number: 1, citation: "Study citation.", evidence_id: ev2.details.evidenceId },
      ],
    }, undefined, undefined, ctx);

    expect(finalized.content[0].text).toContain("正式报告：");
    const finalMd = await readFile(path.join(sessionDir, finalized.details.path), "utf8");
    expect(finalMd).not.toContain("这里只是草稿预览");
    expect(finalMd.match(/^1\. \[1\]/gm)).toHaveLength(1);
    const metadata = JSON.parse(await readFile(path.join(sessionDir, `${finalized.details.path}.metadata.json`), "utf8")) as { references: Array<{ evidence_ids: string[] }> };
    expect(metadata.references[0]!.evidence_ids).toEqual([ev1.details.evidenceId, ev2.details.evidenceId].sort());
    expect(events.map(([name]) => name)).toEqual(["ebm:evidence_added", "ebm:evidence_added", "ebm:report_written"]);
  });

  it("registers evidence tools and emits a domain event after evidence is archived", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const events: Array<[string, unknown]> = [];
    vi.stubEnv("GUIDELINE_MCP_URL", "http://guideline.test/mcp");
    registerEbmTools({
      registerTool: (tool: { name: string; execute: (...args: any[]) => Promise<any> }) => tools.set(tool.name, tool),
      on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler),
      events: { emit: (name: string, payload: unknown) => events.push([name, payload]) },
    } as never);
    expect(handlers.has("session_compact")).toBe(true);
    expect([...tools.keys()].sort()).toEqual([
      "evidence_add",
      "evidence_list",
      "evidence_read",
      "guideline_mcp_read",
      "guideline_mcp_retrieve",
      "guideline_mcp_search",
      "pubmed_read",
      "pubmed_search",
      "pubmed_similar",
      "read_list",
      "report_finalize",
      "report_write",
      "research_frame_init",
      "research_frame_read",
      "research_frame_scratchpad_append",
      "research_frame_update",
      "source_library_search",
      "web_read",
      "web_search",
    ]);

    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-pi-tools-"));
    const sessionId = "session-1";
    const sessionDir = await initializePiSessionDirectory(cwd, sessionId, { sessionName: "Mortality evidence", firstPrompt: "Does it work?" });
    await mkdir(path.join(sessionDir, "sources", "read"), { recursive: true });
    await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "header\nexact evidence", "utf8");
    const ctx = { cwd, sessionManager: { getSessionId: () => sessionId } };

    const result = await tools.get("evidence_add")!.execute("call-1", {
      question: "Does it work?",
      claim: "It works.",
      relation: "supports",
      source_path: piReadableSessionPath(cwd, sessionId, "sources/read/study.md"),
      line_start: 1,
      line_end: 2,
      start_text: "exact",
      end_text: "evidence",
    }, undefined, undefined, ctx);

    expect(result.content[0].text).toContain("Evidence archived");
    expect(result.content[0].text).not.toContain("Exact source:");
    expect(result.details.path).toMatch(/^evidence\/ev_[a-f0-9]{16}\.md$/);
    expect(result.details.node.sourcePath).toBe("sources/read/study.md");
    expect(events).toEqual([["ebm:evidence_added", expect.objectContaining({ sessionId, path: result.details.path })]]);
  });
});
