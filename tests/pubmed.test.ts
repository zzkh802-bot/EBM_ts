import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPubMed, searchPubMed } from "../src/tools/pubmed.js";

function mockFetch(responses: Response[]) {
  const urls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    urls.push(String(input));
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  return { fetcher: fetcher as typeof fetch, urls };
}

const articleXml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><ArticleTitle>Aspirin trial</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Clinical background.</AbstractText><AbstractText Label="RESULTS">Reduced events.</AbstractText></Abstract><Journal><Title>Medical Journal</Title></Journal></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">123</ArticleId><ArticleId IdType="doi">10.1/example</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;

describe("PubMed archive adapters", () => {
  it("searches PubMed, fetches summaries, and archives readable metadata", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      Response.json({ esearchresult: { idlist: ["123"] } }),
      Response.json({ result: { uids: ["123"], "123": { uid: "123", title: "Aspirin trial", pubdate: "2025", source: "Medical Journal", authors: [{ name: "Smith J" }] } } }),
    ]);

    const result = await searchPubMed({
      sessionDir,
      query: "aspirin prevention",
      fetcher: mock.fetcher,
      email: "test@example.com",
      apiKey: "test-secret",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pmids).toEqual(["123"]);
    expect(result.archive.content).toContain("PMID: 123");
    expect(result.archive.content).toContain("Aspirin trial");
    expect(await readFile(path.join(sessionDir, result.archive.path), "utf8")).toContain("Smith J");
    expect(mock.urls.some((url) => url.includes("api_key=test-secret"))).toBe(true);
    expect(result.archive.sourceUrl).not.toContain("api_key");
  });

  it("reads a PMID abstract into an archived Markdown source", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([new Response(articleXml, { headers: { "content-type": "application/xml" } })]);

    const result = await readPubMed({ sessionDir, identifier: "123", fetcher: mock.fetcher, email: "test@example.com" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pmid).toBe("123");
    expect(result.archive.content).toContain("## Abstract");
    expect(result.archive.content).toContain("**RESULTS:** Reduced events.");
    expect(result.archive.content).toContain("DOI: 10.1/example");
  });

  it("retries transient NCBI failures before archiving a successful response", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      new Response("temporary", { status: 503 }),
      Response.json({ esearchresult: { idlist: [] } }),
    ]);
    const result = await searchPubMed({ sessionDir, query: "aspirin", fetcher: mock.fetcher, retries: 1 });
    expect(result).toMatchObject({ ok: true, pmids: [] });
    expect(mock.urls).toHaveLength(2);
  });

  it("returns structured NCBI errors rather than empty success", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([new Response("rate limited", { status: 429 })]);
    const result = await searchPubMed({ sessionDir, query: "aspirin", fetcher: mock.fetcher, retries: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: "ncbi_request_failed", status: 429 } });
  });
});
