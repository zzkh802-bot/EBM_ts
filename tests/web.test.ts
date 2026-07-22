import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readWeb, searchWeb } from "../src/tools/web.js";

function mockFetch(responses: Response[]) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init ? { init } : {}) });
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

describe("archived web tools", () => {
  it("reads through Jina and returns archived absolute line offsets", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const mock = mockFetch([new Response("Title\r\n\r\n" + "clinical evidence ".repeat(80), { status: 200 })]);

    const result = await readWeb({ sessionDir, url: "https://example.com/study", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe("jina");
    expect(result.archive.path).toMatch(/^sources\/read\/read-/);
    const saved = await readFile(path.join(sessionDir, result.archive.path), "utf8");
    expect(saved.split("\n").slice(result.archive.bodyLineOffset).join("\n")).toBe(result.archive.content);
    expect(mock.calls[0]!.input).toBe("https://r.jinaai.cn/https://example.com/study");
  });

  it("uses MinerU before web readers for document URLs", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const archive = zipSync({ "result/full.md": strToU8("# PDF result\n\nParsed evidence.") });
    const mock = mockFetch([
      Response.json({ data: { task_id: "pdf-1" } }),
      Response.json({ data: { state: "done", full_zip_url: "https://cdn.example/result.zip" } }),
      new Response(archive),
    ]);
    const result = await readWeb({
      sessionDir,
      url: "https://example.org/study.pdf",
      fetcher: mock.fetcher,
      mineruApiToken: "token",
    });
    expect(result).toMatchObject({ ok: true, provider: "mineru" });
    expect(mock.calls).toHaveLength(3);
  });

  it("falls back to Firecrawl and reports all failures explicitly", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const fallback = mockFetch([
      new Response("upstream failed", { status: 502 }),
      Response.json({ success: true, data: { markdown: "fallback body", metadata: { title: "Fallback" } } }),
    ]);
    const success = await readWeb({
      sessionDir,
      url: "https://example.com/fallback",
      fetcher: fallback.fetcher,
      firecrawlApiKey: "test-key",
    });
    expect(success).toMatchObject({ ok: true, provider: "firecrawl" });

    const failed = mockFetch([
      new Response("jina unavailable", { status: 503 }),
      new Response("firecrawl unavailable", { status: 500 }),
    ]);
    const failure = await readWeb({
      sessionDir,
      url: "https://example.com/failure",
      fetcher: failed.fetcher,
      firecrawlApiKey: "test-key",
    });
    expect(failure).toMatchObject({
      ok: false,
      error: { code: "all_readers_failed", attempts: [{ provider: "jina" }, { provider: "firecrawl" }] },
    });
  });

  it("searches Tavily and archives the complete model-visible result set without quota data", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const mock = mockFetch([Response.json({
      query: "aspirin prevention",
      response_time: 0.7,
      usage: { credits: 99 },
      results: [{ title: "Trial", url: "https://example.org/trial", content: "Trial abstract", score: 0.91 }],
    })]);

    const result = await searchWeb({ sessionDir, query: "aspirin prevention", fetcher: mock.fetcher, tavilyApiKey: "test-key" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archive.content).toContain("Trial abstract");
    expect(result.archive.content).not.toContain("credits");
    expect(result.archive.content).not.toContain("response_time");
    expect(await readFile(path.join(sessionDir, result.archive.path), "utf8")).toContain(result.archive.content);
  });
});
