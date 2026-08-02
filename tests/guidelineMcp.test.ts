import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GuidelineMcpClient, readGuideline, retrieveGuidelines, searchGuidelines } from "../src/tools/guidelineMcp.js";

function rpcResponse(payload: unknown, sessionId?: string): Response {
  return Response.json(payload, { headers: sessionId ? { "mcp-session-id": sessionId } : {} });
}

describe("guideline MCP", () => {
  it("passes caller cancellation signals through guideline tool calls", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const result = await searchGuidelines({
      sessionDir,
      query: "thyroid",
      signal: controller.signal,
      client: {
        async callTool(_name, _args, signal) {
          received = signal;
          return { text: "[]", raw: {} };
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(received).toBe(controller.signal);
  });

  it("initializes Streamable HTTP and calls tools with the negotiated session", async () => {
    const requests: Array<{ body: any; session?: string }> = [];
    const responses = [
      rpcResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }, "session-1"),
      new Response(null, { status: 202 }),
      new Response('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"result text"}]}}\n\n', { headers: { "content-type": "text/event-stream" } }),
    ];
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)), ...(new Headers(init?.headers).get("mcp-session-id") ? { session: new Headers(init?.headers).get("mcp-session-id")! } : {}) });
      return responses.shift()!;
    };
    const client = new GuidelineMcpClient({ endpoint: "http://guideline.test/mcp", fetcher: fetcher as typeof fetch });

    const result = await client.callTool("search", { query: "heart failure" });

    expect(result.text).toBe("result text");
    expect(requests.map((request) => request.body.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(requests[2]!.session).toBe("session-1");
  });

  it("prefers the structured MCP contract and expands its result array", async () => {
    const responses = [
      rpcResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }, "session-1"),
      new Response(null, { status: 202 }),
      new Response('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"legacy presentation copy"}],"structuredContent":{"result":[{"doc_id":"g1","title":"First"},{"doc_id":"g2","title":"Second"}]}}}\n\n', { headers: { "content-type": "text/event-stream" } }),
    ];
    const client = new GuidelineMcpClient({
      endpoint: "http://guideline.test/mcp",
      fetcher: (async () => responses.shift()!) as typeof fetch,
    });

    const response = await client.callTool("search", { query: "heart failure" });
    const result = await searchGuidelines({ sessionDir: await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-")), query: "heart failure", client: { callTool: async () => response } });

    expect(response.text).toBe(JSON.stringify({ result: [{ doc_id: "g1", title: "First" }, { doc_id: "g2", title: "Second" }] }));
    expect(result.ok && result.items.map((item) => item.docId)).toEqual(["g1", "g2"]);
  });

  it("reports malformed protocol JSON and timeout errors explicitly", async () => {
    const malformed = new GuidelineMcpClient({
      endpoint: "http://guideline.test/mcp",
      fetcher: (async () => new Response("not-json", { headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    await expect(malformed.callTool("search", {})).rejects.toThrow(/invalid JSON/);

    const timeout = new GuidelineMcpClient({
      endpoint: "http://guideline.test/mcp",
      timeoutMs: 10,
      fetcher: ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch,
    });
    await expect(timeout.callTool("search", {})).rejects.toThrow(/timed out/);
  });

  it("removes embedded transport frontmatter and derives a semantic title for generic guideline envelopes", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const client = {
      callTool: async () => ({
        text: JSON.stringify({
          title: "Guideline",
          content: "---\nid: internal_hash\nsource_file: D:\\\\private\\\\raw.pdf\n---\n\n# Guideline\n\n## 2025 update to European Stroke Organisation\n\n## guideline on blood pressure management\n\nRecommendation text.",
        }),
        raw: {},
      }),
    };
    const result = await readGuideline({ sessionDir, docId: "internal_hash", client });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.path).toBe("sources/read/2025-update-to-european-stroke-organisation-guideline-on-blood-pressure/full.md");
    expect(result.archive.content).not.toContain("source_file:");
    expect(result.archive.content).not.toContain("internal_hash");
    const toc = await readFile(path.join(sessionDir, result.archive.tocPath!), "utf8");
    expect(toc).toContain("# Guideline Source Index");
    expect(toc).toContain("Note: noisy PDF headings");
  });

  it("repairs concatenated guideline search objects with literal newlines without truncating document information", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const client = {
      callTool: async () => ({
        text: '{\n"doc_id":"g1","title":"Open access","abstract":"First line\nsecond line","source_institution":"PMC"\n}\n{\n"doc_id":"g2","title":"Named Guideline","abstract":"Other result"\n}',
        raw: {},
      }),
    };
    const result = await searchGuidelines({ sessionDir, query: "stroke", client });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.content).toContain("Results: 2");
    expect(result.archive.content).toContain("- 1. PMC result 1 — document ID: g1");
    expect(result.archive.content).toContain("- 2. Named Guideline — document ID: g2");
    expect(result.items[0]).toMatchObject({ docId: "g1", institution: "PMC", abstract: "First line\nsecond line" });
    expect(result.archive.content).toContain("First line\nsecond line");
    expect(result.archive.content).not.toContain('"doc_id"');
  });

  it("preserves the matched document view and exposes other available views without dumping them", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const client = {
      callTool: async () => ({
        text: JSON.stringify([{ doc_id: "g1", title: "Guideline", abstract: "journal metadata and boilerplate", view_type: "recommendation_summary", document_views: { recommendation_summary: "Use alteplase according to acute stroke guideline criteria.", pico_questions: "This non-matched view must not be dumped into model context." } }]),
        raw: {},
      }),
    };

    const result = await searchGuidelines({ sessionDir, query: "stroke alteplase", client });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.content).toContain("Use alteplase according to acute stroke guideline criteria.");
    expect(result.archive.content).toContain("journal metadata and boilerplate");
    expect(result.archive.content).not.toContain("This non-matched view must not be dumped into model context.");
    expect(result.items[0]!.matchedViewContent).toBe("Use alteplase according to acute stroke guideline criteria.");
    expect(result.items[0]!.availableViewTypes).toEqual(["recommendation_summary", "pico_questions"]);
  });

  it("archives search and read output before returning it", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const calls: string[] = [];
    const client = {
      callTool: async (name: string) => {
        calls.push(name);
        return {
          text: name === "search"
            ? '[{"doc_id":"g1","title":"Guideline"}]'
            : JSON.stringify({ doc_id: "g1_hash", title: "Heart Failure Guideline 2025", content: "# Guideline\n\nRecommendation&#xa0;text." }),
          raw: {},
        };
      },
    };
    const search = await searchGuidelines({ sessionDir, query: "heart failure", client });
    const read = await readGuideline({ sessionDir, docId: "g1", client });

    expect(calls).toEqual(["search", "read"]);
    expect(search.ok && search.archive.path).toMatch(/^sources\/search/);
    if (search.ok) {
      expect(search.archive.content).toContain("## 1. Guideline");
      expect(search.archive.content).toContain("- Document ID: g1");
      expect(search.archive.content).not.toContain('[{"doc_id"');
    }
    if (search.ok) expect(search.items[0]).toMatchObject({ docId: "g1", title: "Guideline result 1" });
    expect(read.ok && read.archive.path).toBe("sources/read/heart-failure-guideline-2025/full.md");
    if (read.ok) {
      const archived = await readFile(path.join(sessionDir, read.archive.path), "utf8");
      expect(archived).toContain("Recommendation text");
      expect(archived).not.toContain("doc_id");
    }
  });

  it("retrieves compact RAG chunk candidates", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const client = {
      callTool: async () => ({
        text: JSON.stringify([{ doc_id: "g1", chunk_id: "g1#1", title: "Stroke guideline", section_path: ["Stroke", "BP"], content: "BP recommendation text", score: 0.2 }]),
        raw: {},
      }),
    };

    const result = await retrieveGuidelines({ sessionDir, query: "stroke blood pressure", client });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({ docId: "g1", chunkId: "g1#1", title: "Stroke guideline", section: "Stroke > BP", candidateMaterial: "BP recommendation text" });
    expect(result.items[0]!.sourcePath).toMatch(/^sources\/read\//);
    expect(result.items[0]!.sourcePath).toMatch(/\.md$/);
    expect(result.items[0]!.sourcePath).not.toMatch(/\/full\.md$/);
    expect(result.items[0]!.lineStart).toBeTypeOf("number");
    expect(result.items[0]!.lineEnd).toBeTypeOf("number");
    expect(result.archive.content).toContain("# Guideline retrieve: stroke blood pressure");
    expect(result.archive.content).not.toContain('"chunk_id"');
  });

  it("archives retrieve content rather than its truncated display context", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const client = {
      callTool: async () => ({
        text: JSON.stringify([{
          doc_id: "g1",
          chunk_id: "g1#1",
          title: "Stroke guideline",
          content: "Complete candidate material, including the condition that changes the recommendation.",
          source_quote_context: "[current] Complete candidate material...",
        }]),
        raw: {},
      }),
    };

    const result = await retrieveGuidelines({ sessionDir, query: "stroke treatment", client });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]!.candidateMaterial).toBe("Complete candidate material, including the condition that changes the recommendation.");
    expect(result.items[0]!.candidateMaterial).not.toContain("[current]");
    expect(result.items[0]!.lineStart).toBe(8);
    expect(result.items[0]!.lineEnd).toBe(8);
    const archived = await readFile(path.join(sessionDir, result.items[0]!.sourcePath!), "utf8");
    expect(archived).toContain("including the condition that changes the recommendation.");
    expect(archived).not.toContain("## Source metadata");
    expect(archived).not.toContain("## Retrieved guideline chunk");
  });

  it("returns the normalized archived candidate body to the model", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-guideline-"));
    const rawMaterial = `First&nbsp;candidate line.\n${"long material ".repeat(40)}`;
    const result = await retrieveGuidelines({
      sessionDir,
      query: "archive consistency",
      client: {
        callTool: async () => ({
          text: JSON.stringify([{ doc_id: "g1", chunk_id: "g1#1", title: "Guideline", content: rawMaterial }]),
          raw: {},
        }),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const archived = await readFile(path.join(sessionDir, result.items[0]!.sourcePath!), "utf8");
    const archivedBody = archived.slice(archived.indexOf("---\n\n") + "---\n\n".length);
    expect(result.items[0]!.candidateMaterial).toBe(archivedBody);
    expect(result.items[0]!.candidateMaterial).not.toContain("&nbsp;");
  });
});
