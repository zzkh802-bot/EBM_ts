import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDocumentBytes, parseDocumentUrl } from "../src/tools/mineru.js";

function mockFetch(responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

describe("MinerU Premium document parsing", () => {
  it("creates, polls, downloads, and extracts Markdown from a Premium task", async () => {
    const archive = zipSync({ "result/full.md": strToU8("# Parsed PDF\n\nClinical result.") });
    const mock = mockFetch([
      Response.json({ data: { task_id: "task-1" } }),
      Response.json({ data: { state: "running" } }),
      Response.json({ data: { state: "done", full_zip_url: "https://cdn.example/result.zip" } }),
      new Response(archive),
    ]);

    const result = await parseDocumentUrl({
      url: "https://example.org/paper.pdf",
      apiToken: "token",
      fetcher: mock.fetcher,
      pollIntervalMs: 0,
    });

    expect(result).toMatchObject({ parser: "mineru-premium-url", taskId: "task-1", content: "# Parsed PDF\n\nClinical result." });
    expect(mock.calls[0]).toMatchObject({ url: "https://mineru.net/api/v4/extract/task", init: { method: "POST" } });
    expect(new Headers(mock.calls[0]!.init?.headers).get("authorization")).toBe("Bearer token");
    expect(JSON.parse(String(mock.calls[0]!.init?.body))).toMatchObject({ model_version: "vlm" });
  });

  it("uploads locally downloaded bytes through a signed Premium batch URL", async () => {
    const archive = zipSync({ "result/full.md": strToU8("# Uploaded PDF\n\nRecovered OA content.") });
    const mock = mockFetch([
      Response.json({ data: { batch_id: "batch-1", file_urls: ["https://upload.example/signed"] } }),
      new Response(null, { status: 200 }),
      Response.json({ data: { extract_result: [{ state: "done", full_zip_url: "https://cdn.example/uploaded.zip" }] } }),
      new Response(archive),
    ]);
    const result = await parseDocumentBytes({
      bytes: strToU8("%PDF-1.7 fake"),
      fileName: "article.pdf",
      apiToken: "token",
      fetcher: mock.fetcher,
      pollIntervalMs: 0,
    });
    expect(result).toMatchObject({ parser: "mineru-premium-upload", taskId: "batch-1", content: "# Uploaded PDF\n\nRecovered OA content." });
    expect(mock.calls[1]).toMatchObject({ url: "https://upload.example/signed", init: { method: "PUT" } });
    expect(new Headers(mock.calls[1]!.init?.headers).has("content-type")).toBe(false);
    expect(JSON.parse(String(mock.calls[0]!.init?.body))).toMatchObject({ model_version: "vlm" });
  });

  it("fails explicitly for task failure, malformed ZIP, and timeout", async () => {
    const failed = mockFetch([
      Response.json({ data: { task_id: "task-2" } }),
      Response.json({ data: { state: "failed", err_msg: "unsupported document" } }),
    ]);
    await expect(parseDocumentUrl({ url: "https://example.org/a.pdf", apiToken: "token", fetcher: failed.fetcher, pollIntervalMs: 0 }))
      .rejects.toThrow(/unsupported document/);

    const malformed = mockFetch([
      Response.json({ data: { task_id: "task-3" } }),
      Response.json({ data: { state: "done", full_zip_url: "https://cdn.example/result.zip" } }),
      new Response(zipSync({ "result/data.json": strToU8("{}") })),
    ]);
    await expect(parseDocumentUrl({ url: "https://example.org/a.pdf", apiToken: "token", fetcher: malformed.fetcher, pollIntervalMs: 0 }))
      .rejects.toThrow(/does not contain Markdown/);
  });
});
