import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { registerEbmTools } from "../src/extensions/ebmTools.js";
import { renderAbstractNavigation } from "../src/extensions/pubmedTools.js";

describe("EBM Pi extension tools", () => {
  it("returns evidence-ready PubMed abstract paths with exact readable windows", () => {
    const output = renderAbstractNavigation("session-1", [{
      path: "sources/read/trial/full.md",
      title: "Trial",
      bodyLineStart: 8,
      content: "# Trial\n\n## Abstract\n\nResult line one.\nResult line two.\n",
    }]);
    expect(output).toContain("Evidence source_path: sources/read/trial/full.md");
    expect(output).toContain("Complete abstract lines: 12-13");
    expect(output).toContain('read(path="data/sessions/session-1/sources/read/trial/full.md", offset=12, limit=2)');
    expect(output).toContain("Evidence provenance: primary_abstract");
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

  it("registers evidence tools and emits a domain event after evidence is archived", async () => {
    const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const events: Array<[string, unknown]> = [];
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
      "guideline_mcp_search",
      "pubmed_read",
      "pubmed_search",
      "report_write",
      "web_read",
      "web_search",
    ]);

    const cwd = await mkdtemp(path.join(os.tmpdir(), "ebm-pi-tools-"));
    const sessionId = "session-1";
    const sessionDir = path.join(cwd, "data", "sessions", sessionId);
    await mkdir(path.join(sessionDir, "sources", "read"), { recursive: true });
    await writeFile(path.join(sessionDir, "sources", "read", "study.md"), "header\nexact evidence", "utf8");
    const ctx = { cwd, sessionManager: { getSessionId: () => sessionId } };

    const result = await tools.get("evidence_add")!.execute("call-1", {
      question: "Does it work?",
      claim: "It works.",
      relation: "supports",
      source_path: "data/sessions/session-1/sources/read/study.md",
      offset: 2,
      limit: 1,
    }, undefined, undefined, ctx);

    expect(result.content[0].text).toContain("Evidence archived");
    expect(result.details.path).toMatch(/^evidence\/ev_[a-f0-9]{16}\.md$/);
    expect(result.details.node.sourcePath).toBe("sources/read/study.md");
    expect(events).toEqual([["ebm:evidence_added", expect.objectContaining({ sessionId, path: result.details.path })]]);
  });
});
