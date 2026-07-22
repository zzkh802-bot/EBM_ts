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

const articleXml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><ArticleTitle>Aspirin trial</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Clinical background.</AbstractText><AbstractText Label="RESULTS">Reduced events.</AbstractText></Abstract><Journal><Title>Medical Journal</Title></Journal></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">123</ArticleId><ArticleId IdType="pmc">PMC999</ArticleId><ArticleId IdType="doi">10.1/example</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
const pmcXml = `<?xml version="1.0"?><pmc-articleset><article><front><article-meta><title-group><article-title>Aspirin trial</article-title></title-group></article-meta></front><body><sec><title>Results</title><p>The full text reports reduced cardiovascular events.</p></sec><sec><title>Limitations</title><p>Follow-up was limited.</p></sec></body></article></pmc-articleset>`;

describe("PubMed archive adapters", () => {
  it("searches PubMed, fetches summaries, and archives readable metadata", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      Response.json({ esearchresult: { idlist: ["123"] } }),
      new Response(articleXml, { headers: { "content-type": "application/xml" } }),
      Response.json({ linksets: [{ ids: ["123"], linksetdbs: [{ linkname: "pubmed_pubmed", links: ["456"] }] }] }),
      Response.json({ result: { uids: ["456"], "456": { uid: "456", title: "Similar prevention trial", pubdate: "2024", source: "Related Journal" } } }),
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
    expect(result.archive.content).toContain("**RESULTS:** Reduced events.");
    expect(result.archive.content).toContain("Similar prevention trial");
    expect(result.relatedPmids).toEqual(["456"]);
    expect(await readFile(path.join(sessionDir, result.archive.path), "utf8")).toContain("Source status: PubMed abstract");
    expect(mock.urls.some((url) => url.includes("api_key=test-secret"))).toBe(true);
    expect(result.archive.sourceUrl).not.toContain("api_key");
  });

  it("uses pubmed_read to fetch and archive PMC full text", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      new Response(articleXml, { headers: { "content-type": "application/xml" } }),
      new Response(pmcXml, { headers: { "content-type": "application/xml" } }),
    ]);

    const result = await readPubMed({ sessionDir, identifier: "123", fetcher: mock.fetcher, email: "test@example.com" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pmid).toBe("123");
    expect(result.pmcid).toBe("PMC999");
    expect(result.fullText).toBe(true);
    expect(result.archive.content).toContain("## Full Text");
    expect(result.archive.content).toContain("The full text reports reduced cardiovascular events.");
    expect(result.archive.content).toContain("DOI: 10.1/example");
  });

  it("keeps abstract search results when optional similar-article lookup fails", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      Response.json({ esearchresult: { idlist: ["123"] } }),
      new Response(articleXml),
      new Response("related service unavailable", { status: 503 }),
    ]);
    const result = await searchPubMed({ sessionDir, query: "aspirin", fetcher: mock.fetcher, retries: 0 });
    expect(result).toMatchObject({ ok: true, pmids: ["123"], relatedPmids: [] });
    if (result.ok) expect(result.warnings[0]).toContain("similar-article lookup failed");
  });

  it("returns an explicit abstract-only result when no PMCID is available", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const abstractOnlyXml = articleXml.replace('<ArticleId IdType="pmc">PMC999</ArticleId>', "");
    const mock = mockFetch([new Response(abstractOnlyXml, { headers: { "content-type": "application/xml" } })]);
    const result = await readPubMed({ sessionDir, identifier: "123", fetcher: mock.fetcher });
    expect(result).toMatchObject({ ok: true, fullText: false });
    if (result.ok) {
      expect(result.archive.content).toContain("abstract only; full text unavailable");
      expect(result.warnings[0]).toContain("No PMCID");
    }
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
