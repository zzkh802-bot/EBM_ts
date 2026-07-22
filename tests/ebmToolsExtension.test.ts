import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { registerEbmTools } from "../src/extensions/ebmTools.js";
import { renderGuidelineReadText } from "../src/extensions/guidelineTools.js";
import { renderAbstractNavigation } from "../src/extensions/pubmedTools.js";
import { initializePiSessionDirectory, piReadableSessionPath } from "../src/extensions/sessionPath.js";

describe("EBM Pi extension tools", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns evidence-ready PubMed abstract paths with exact readable windows", () => {
    const output = renderAbstractNavigation("session-1", [{
      path: "sources/read/trial/full.md",
      title: "Trial",
      bodyLineStart: 8,
      content: "# Trial\n\n## Abstract\n\nResult line one.\nResult line two.\n",
    }]);
    expect(output).toContain("PMID: unknown");
    expect(output).toContain("Abstract preview: Result line one. Result line two.");
    expect(output).toContain("Readable abstract path: data/sessions/session-1/sources/read/trial/full.md");
    expect(output).toContain("Exact abstract lines: 12-13");
    expect(output).not.toContain("Evidence source_path:");
    expect(output).not.toContain("Source map");
    expect(output).not.toContain("Read any archive window");
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
    expect(text).toContain("Useful section map:");
    expect(text).toContain("## Abstract");
    expect(text).toContain("## Evidence-based Recommendation 1");
    expect(text).toContain("We recommend intravenous alteplase");
    expect(text).not.toContain("Joanna M Wardlaw");
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
      "report_write",
      "research_frame_init",
      "research_frame_read",
      "research_frame_scratchpad_append",
      "research_frame_update",
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
      offset: 2,
      limit: 1,
    }, undefined, undefined, ctx);

    expect(result.content[0].text).toContain("Evidence archived");
    expect(result.content[0].text).not.toContain("Exact source:");
    expect(result.details.path).toMatch(/^evidence\/ev_[a-f0-9]{16}\.md$/);
    expect(result.details.node.sourcePath).toBe("sources/read/study.md");
    expect(events).toEqual([["ebm:evidence_added", expect.objectContaining({ sessionId, path: result.details.path })]]);
  });
});
