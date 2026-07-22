import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GuidelineMcpClient, readGuideline, searchGuidelines } from "../src/tools/guidelineMcp.js";

function rpcResponse(payload: unknown, sessionId?: string): Response {
  return Response.json(payload, { headers: sessionId ? { "mcp-session-id": sessionId } : {} });
}

describe("guideline MCP", () => {
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
    expect(read.ok && read.archive.path).toBe("sources/read/heart-failure-guideline-2025/full.md");
    if (read.ok) {
      const archived = await readFile(path.join(sessionDir, read.archive.path), "utf8");
      expect(archived).toContain("Recommendation text");
      expect(archived).not.toContain("doc_id");
    }
  });
});
