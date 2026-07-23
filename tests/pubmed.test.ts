import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readPubMed, searchPubMed, similarPubMed } from "../src/tools/pubmed.js";

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

const articleXml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><ArticleTitle>Aspirin trial</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Clinical background.</AbstractText><AbstractText Label="RESULTS">Reduced events with <i>p</i> &lt; 0.001.</AbstractText></Abstract><Journal><Title>Medical Journal</Title></Journal></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">123</ArticleId><ArticleId IdType="pmc">PMC999</ArticleId><ArticleId IdType="doi">10.1/example</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
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
      includeSimilar: true,
      email: "test@example.com",
      apiKey: "test-secret",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pmids).toEqual(["123"]);
    expect(result.archive.content).toContain("PMID: 123");
    expect(result.archive.content).toContain("Aspirin trial");
    expect(result.archive.content).toContain("**RESULTS:** Reduced events with p < 0.001.");
    expect(result.archive.content).toContain("Similar prevention trial (Journal: Related Journal; Date: 2024)");
    expect(result.archive.content).toContain('pubmed_read(identifier="PMID: 456")');
    expect(result.relatedPmids).toEqual(["456"]);
    expect(result.abstractArchives).toHaveLength(1);
    expect(result.abstractArchives[0]!.path).toBe("sources/read/aspirin-trial/full.md");
    expect(result.archive.content).toContain(`Citation-capable abstract source: ${result.abstractArchives[0]!.path}`);
    expect(await readFile(path.join(sessionDir, result.abstractArchives[0]!.path), "utf8")).toContain("**RESULTS:** Reduced events with p < 0.001.");
    expect(await readFile(path.join(sessionDir, result.archive.path), "utf8")).toContain("Source status: PubMed abstract");
    expect(mock.urls.some((url) => url.includes("api_key=test-secret"))).toBe(true);
    expect(result.archive.sourceUrl).not.toContain("api_key");
  });

  it("expands similar PubMed articles with abstract archives", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const relatedXml = articleXml.replaceAll("123", "456").replace("Aspirin trial", "Related aspirin trial");
    const mock = mockFetch([
      Response.json({ linksets: [{ ids: ["123"], linksetdbs: [{ linkname: "pubmed_pubmed", links: ["456"] }] }] }),
      Response.json({ result: { uids: ["456"], "456": { uid: "456", title: "Related aspirin trial" } } }),
      new Response(relatedXml, { headers: { "content-type": "application/xml" } }),
    ]);

    const result = await similarPubMed({ sessionDir, pmid: "PMID: 123", fetcher: mock.fetcher, maxResults: 5 });

    expect(result).toMatchObject({ ok: true, seedPmid: "123", relatedPmids: ["456"] });
    if (!result.ok) return;
    expect(result.abstractArchives).toHaveLength(1);
    expect(result.abstractArchives[0]!.content).toContain("Related aspirin trial");
    expect(result.archive.content).toContain("PMID: 456");
  });

  it("uses pubmed_read to fetch and archive PMC full text", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      new Response(articleXml, { headers: { "content-type": "application/xml" } }),
      new Response(pmcXml, { headers: { "content-type": "application/xml" } }),
    ]);

    const result = await readPubMed({ sessionDir, identifier: "PMID: 123", fetcher: mock.fetcher, email: "test@example.com" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pmid).toBe("123");
    expect(result.pmcid).toBe("PMC999");
    expect(result.fullText).toBe(true);
    expect(result.archive.content).toContain("## Full Text");
    expect(result.archive.content).toContain("The full text reports reduced cardiovascular events.");
    expect(result.archive.content).toContain("DOI: 10.1/example");
  });

  it("falls back to PMC HTML when PMC XML omits the article body", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const pmcNoBody = `<?xml version="1.0"?><pmc-articleset><article><!--The publisher of this article does not allow downloading of the full text in XML form.--><front /></article></pmc-articleset>`;
    const pmcHtml = `<!doctype html><main id="main-content"><article><section class="body main-article-body"><section><h2>Abstract</h2><p>HTML abstract text.</p></section><section><h2>Results</h2><p>The PMC HTML full text reports clinically important outcomes.</p><ul><li>Outcome one improved.</li></ul></section></section></article></main>`;
    const mock = mockFetch([
      new Response(articleXml, { headers: { "content-type": "application/xml" } }),
      new Response(pmcNoBody, { headers: { "content-type": "application/xml" } }),
      new Response(pmcHtml, { headers: { "content-type": "text/html" } }),
    ]);

    const result = await readPubMed({ sessionDir, identifier: "PMID: 123", fetcher: mock.fetcher, retries: 0 });

    expect(result).toMatchObject({ ok: true, fullText: true, fullTextSource: "pmc" });
    if (!result.ok) return;
    expect(result.archive.sourceUrl).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC999/");
    expect(result.archive.content).toContain("Source status: PMC full text (HTML page)");
    expect(result.archive.content).toContain("The PMC HTML full text reports clinically important outcomes.");
  });

  it("keeps abstract search results when optional similar-article lookup fails", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([
      Response.json({ esearchresult: { idlist: ["123"] } }),
      new Response(articleXml),
      new Response("related service unavailable", { status: 503 }),
    ]);
    const result = await searchPubMed({ sessionDir, query: "aspirin", fetcher: mock.fetcher, retries: 0, includeSimilar: true });
    expect(result).toMatchObject({ ok: true, pmids: ["123"], relatedPmids: [] });
    if (result.ok) expect(result.warnings[0]).toContain("similar-article lookup failed");
  });

  it("adds compact PubMed context for abstract-only records", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const xml = articleXml.replace("<PublicationTypeList>", "");
    const mock = mockFetch([
      new Response(xml, { headers: { "content-type": "application/xml" } }),
      new Response("PMC unavailable", { status: 503 }),
      new Response("<html>No article body</html>", { headers: { "content-type": "text/html" } }),
      Response.json({ linksets: [{ ids: ["123"], linksetdbs: [{ linkname: "pubmed_pubmed", links: ["456"] }] }] }),
      Response.json({ result: { uids: ["456"], "456": { uid: "456", title: "Similar review", source: "Cochrane", pubdate: "2020" } } }),
      Response.json({ linksets: [{ ids: ["123"], linksetdbs: [{ linkname: "pubmed_pubmed_citedin", links: ["789"] }] }] }),
      Response.json({ result: { uids: ["789"], "789": { uid: "789", title: "Citing review", source: "Review Journal", pubdate: "2021" } } }),
    ]);
    const result = await readPubMed({ sessionDir, identifier: "123", fetcher: mock.fetcher, retries: 0, includeContext: true });
    expect(result).toMatchObject({ ok: true, fullText: false, pmcid: "PMC999" });
    if (!result.ok) return;
    expect(result.archive.content).toContain("## PubMed context");
    expect(result.archive.content).toContain("Navigation/context only");
    expect(result.archive.content).toContain("Access hint: Free PMC linked (PMC999)");
    expect(result.archive.content).toContain("Similar review");
    expect(result.archive.content).toContain("Citing review");
    expect(result.archive.content).not.toContain("References from PubMed link graph");
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
    if (result.ok) expect(result.archive.content).toContain("Status: no_results");
    expect(mock.urls).toHaveLength(2);
    expect(mock.urls[1]).toContain("sort=relevance");
  });

  it("returns structured NCBI errors rather than empty success", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-pubmed-"));
    const mock = mockFetch([new Response("rate limited", { status: 429 })]);
    const result = await searchPubMed({ sessionDir, query: "aspirin", fetcher: mock.fetcher, retries: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: "ncbi_request_failed", status: 429 } });
  });
});
