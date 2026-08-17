import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readEuropePmc, searchEuropePmc } from "../src/tools/europePmc.js";

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

const coreRecord = {
  id: "30596806",
  pmid: "30596806",
  pmcid: "PMC8889595",
  doi: "10.1001/jamacardio.2018.4289",
  title: "Aspirin for primary prevention trial",
  authorString: "Example A; Researcher B",
  journalTitle: "European Journal of Example",
  pubYear: "2019",
  isOpenAccess: "Y",
  inPMC: "Y",
  abstractText: "<title>Background</title><p>Clinical background.</p><p>Reduced events with <i>p</i> &lt; 0.001.</p>",
};

const fullTextXml = `<?xml version="1.0"?><!DOCTYPE article PUBLIC "-//NLM//DTD JATS"><article><body><sec><title>Results</title><p>The Open Access full text reports reduced cardiovascular events.</p><sec><title>Sub-analysis</title><p>A secondary subgroup detail.</p></sec></sec><sec><title>Limitations</title><p>Follow-up was limited.</p></sec></body></article>`;

describe("Europe PMC archive adapters", () => {
  it("searches Europe PMC and archives complete abstracts as citation-capable sources", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const mock = mockFetch([
      Response.json({ hitCount: 7092, resultList: { result: [coreRecord, { ...coreRecord, id: "999", pmid: "999", pmcid: undefined, isOpenAccess: "N", inPMC: "N", title: "Non-OA abstract only", abstractText: "" }] } }),
    ]);

    const result = await searchEuropePmc({ sessionDir, query: "aspirin prevention", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pmids).toEqual(["30596806", "999"]);
    expect(result.pmcids).toEqual(["PMC8889595"]);
    expect(result.abstractCount).toBe(1);
    expect(result.fullTextAvailable).toBe(1);
    expect(result.warnings[0]).toContain("no abstract text");
    expect(result.archive.content).toContain("Europe PMC search: aspirin prevention");
    expect(result.archive.content).toContain("Citation-capable abstract source: sources/read/aspirin-for-primary-prevention-trial/full.md");
    expect(result.archive.content).toContain("Source status: Europe PMC abstract");
    expect(result.archive.content).toContain("Evidence provenance: primary_abstract");
    expect(result.abstractArchives).toHaveLength(1);
    expect(result.abstractArchives[0]!.path).toBe("sources/read/aspirin-for-primary-prevention-trial/full.md");
    const archived = await readFile(path.join(sessionDir, result.abstractArchives[0]!.path), "utf8");
    expect(archived).toContain("PMID: 30596806");
    expect(archived).toContain("PMCID: PMC8889595");
    expect(archived).toContain("Reduced events with p < 0.001.");
    expect(archived).toContain("Source status: Europe PMC abstract; Open Access full text available; not archived");
    expect(result.abstractArchives[0]!.sourceUrl).toBe("https://europepmc.org/article/PMC/8889595");
  });

  it("falls back to MED source URLs for records without a PMCID", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const noPmc = { ...coreRecord, id: "123", pmid: "123", pmcid: undefined, isOpenAccess: "N", inPMC: "N", title: "Abstract-only record" };
    const mock = mockFetch([Response.json({ hitCount: 1, resultList: { result: [noPmc] } })]);

    const result = await searchEuropePmc({ sessionDir, query: "case report aspirin", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.abstractArchives[0]!.sourceUrl).toBe("https://europepmc.org/article/MED/123");
  });

  it("archives full text XML when the record is Open Access", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const mock = mockFetch([
      Response.json({ hitCount: 1, resultList: { result: [coreRecord] } }),
      new Response(fullTextXml, { headers: { "content-type": "application/xml" } }),
    ]);

    const result = await readEuropePmc({ sessionDir, identifier: "PMID: 30596806", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({ pmcid: "PMC8889595", pmid: "30596806", fullText: true, fullTextSource: "europepmc_oa" });
    expect(result.archive.content).toContain("Source status: Europe PMC full text (Open Access)");
    expect(result.archive.content).toContain("## Full Text");
    expect(result.archive.content).toContain("The Open Access full text reports reduced cardiovascular events.");
    expect(result.archive.content).toContain("## Sub-analysis");
    expect(result.archive.sourceUrl).toBe("https://europepmc.org/article/PMC/8889595");
    expect(decodeURIComponent(mock.urls[0]!)).toContain("EXT_ID:30596806");
  });

  it("returns an explicit abstract-only result when full text is unavailable", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const closed = { ...coreRecord, isOpenAccess: "N", inPMC: "N" };
    const mock = mockFetch([Response.json({ hitCount: 1, resultList: { result: [closed] } })]);

    const result = await readEuropePmc({ sessionDir, identifier: "30596806", fetcher: mock.fetcher });

    expect(result).toMatchObject({ ok: true, fullText: false, fullTextSource: "abstract_only" });
    if (!result.ok) return;
    expect(result.archive.content).toContain("Source status: Europe PMC abstract; full text unavailable");
    expect(result.archive.content).toContain("## Abstract");
    expect(result.warnings[0]).toContain("not Open Access");
  });

  it("keeps the abstract when full text XML has no readable body", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const mock = mockFetch([
      Response.json({ hitCount: 1, resultList: { result: [coreRecord] } }),
      new Response("<article><body><sec><title>Empty</title></sec></body></article>", { headers: { "content-type": "application/xml" } }),
    ]);

    const result = await readEuropePmc({ sessionDir, identifier: "PMC8889595", fetcher: mock.fetcher });

    expect(result).toMatchObject({ ok: true, fullText: false, fullTextSource: "abstract_only" });
    if (!result.ok) return;
    expect(result.warnings[0]).toContain("no readable paragraphs");
    expect(result.archive.content).toContain("Source status: Europe PMC abstract; full text unavailable");
    expect(decodeURIComponent(mock.urls[0]!)).toContain("PMCID:PMC8889595");
  });

  it("returns structured errors rather than empty success", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const mock = mockFetch([Response.json({ hitCount: 0, resultList: { result: [] } })]);
    const empty = await searchEuropePmc({ sessionDir, query: "aspirin", fetcher: mock.fetcher });
    expect(empty).toMatchObject({ ok: true, pmids: [], archive: expect.anything() });
    if (empty.ok) expect(empty.archive.content).toContain("Status: no_results");

    const badSessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const failing = mockFetch([new Response("rate limited", { status: 429 })]);
    const error = await searchEuropePmc({ sessionDir: badSessionDir, query: "aspirin", fetcher: failing.fetcher, retries: 0 });
    expect(error).toMatchObject({ ok: false, error: { code: "europepmc_request_failed", status: 429 } });
  });

  it("rejects invalid identifiers before any request", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-europepmc-"));
    const result = await readEuropePmc({ sessionDir, identifier: "", fetcher: mockFetch([]).fetcher });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});