import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readWeb, renderSearchCandidatesText, searchWeb } from "../src/tools/web.js";
import { searchSourceLibrary, sourceLibraryMetadataFields } from "../src/tools/sourceLibrary.js";
import { expandSourceLibraryQueryTerms } from "../src/tools/sourceLibraryTerms.js";

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
  it("expands bilingual source-library query terms", () => {
    expect(expandSourceLibraryQueryTerms("成人急性髓系白血病 大剂量阿糖胞苷 巩固治疗")).toEqual(expect.arrayContaining(["acute myeloid leukemia", "cytarabine", "consolidation"]));
    expect(expandSourceLibraryQueryTerms("卒中 rt-PA 溶栓")).toEqual(expect.arrayContaining(["stroke", "alteplase", "thrombolysis"]));
  });

  it("extracts PubMed identifiers and search keywords for source-library metadata", () => {
    const fields = sourceLibraryMetadataFields({
      title: "A randomized comparison of high-dose cytarabine alone in acute myeloid leukemia: the JALSG AML201 Study.",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/21190996/",
      provider: "pubmed",
      content: [
        "PMID: 21190996",
        "PMCID: PMC1234567",
        "DOI: 10.1182/blood.example",
        "Journal: Blood. 2011;117(8):2366-2372.",
        "Publication types: Randomized Controlled Trial; Clinical Trial",
      ].join("\n"),
    });

    expect(fields).toMatchObject({ pmid: "21190996", pmcid: "PMC1234567", doi: "10.1182/blood.example", year: "2011" });
    expect(fields.publication_types).toContain("Randomized Controlled Trial");
    expect(fields.keywords.join(" ")).toContain("AML acute myeloid leukemia");
    expect(fields.keywords.join(" ")).toContain("cytarabine Ara-C");
  });

  it("stores discovery queries and bilingual outcome aliases for source-library metadata", () => {
    const fields = sourceLibraryMetadataFields({
      title: "A randomized comparison of standard-dose multiagent chemotherapy versus high-dose cytarabine consolidation in AML.",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/21190996/",
      provider: "pubmed",
      discoveryQuery: "成人急性髓系白血病 大剂量阿糖胞苷 巩固治疗 DFS OS 复发 严重不良反应",
      content: "PMID: 21190996\nJournal: Blood. 2011;117(8):2366-2372.",
    });

    expect(fields.discovery_queries).toEqual(["成人急性髓系白血病 大剂量阿糖胞苷 巩固治疗 DFS OS 复发 严重不良反应"]);
    expect(fields.keywords.join(" ")).toContain("无病生存");
    expect(fields.keywords.join(" ")).toContain("总生存");
    expect(fields.keywords.join(" ")).toContain("严重不良反应");
  });

  it("searches the local source library with Chinese guideline terms", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ebm-source-library-"));
    const entry = path.join(root, "chinese-aml-2023");
    await mkdir(entry, { recursive: true });
    await writeFile(path.join(entry, "metadata.json"), JSON.stringify({
      title: "成人急性髓系白血病（非急性早幼粒细胞白血病）中国诊疗指南（2023年版）",
      source_url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10630568/",
      aliases: ["中国 AML 指南 2023", "急性髓系白血病 巩固治疗"],
    }), "utf8");
    await writeFile(path.join(entry, "full.md"), "# 指南\n\n巩固治疗推荐大剂量阿糖胞苷。", "utf8");

    const results = await searchSourceLibrary({ sourceLibraryDir: root, query: "急性髓系白血病 巩固治疗 大剂量阿糖胞苷" });

    expect(results[0]).toMatchObject({ slug: "chinese-aml-2023", sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10630568/" });
  });

  it("reads through Jina and returns archived absolute line offsets", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const mock = mockFetch([new Response("Title\r\n\r\n" + "clinical evidence ".repeat(80), { status: 200 })]);

    const result = await readWeb({ sessionDir, url: "https://example.com/study", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe("jina");
    expect(result.archive.path).toBe("sources/read/study/full.md");
    expect(result.archive.tocPath).toBe("sources/read/study/toc.md");
    const saved = await readFile(path.join(sessionDir, result.archive.path), "utf8");
    expect(saved.split("\n").slice(result.archive.bodyLineStart - 1).join("\n")).toBe(result.archive.content);
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

  it("detects an extensionless PDF by Content-Type before selecting MinerU", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const archive = zipSync({ "result/full.md": strToU8("# Extensionless PDF\n\nParsed by VLM.") });
    const mock = mockFetch([
      new Response(null, { headers: { "content-type": "application/pdf" } }),
      Response.json({ data: { task_id: "pdf-head-1" } }),
      Response.json({ data: { state: "done", full_zip_url: "https://cdn.example/result.zip" } }),
      new Response(archive),
    ]);
    const result = await readWeb({
      sessionDir,
      url: "https://example.org/download?id=123",
      fetcher: mock.fetcher,
      mineruApiToken: "token",
      resolveHost: async () => ["93.184.216.34"],
    });
    expect(result).toMatchObject({ ok: true, provider: "mineru" });
    expect(mock.calls[0]).toMatchObject({ input: "https://example.org/download?id=123", init: { method: "HEAD" } });
    expect(mock.calls[1]!.input).toBe("https://mineru.net/api/v4/extract/task");
  });

  it("stops without fallback for PDFs above the page preflight limit", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const twoPagePdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj");
    const mock = mockFetch([
      new Response(twoPagePdf, { headers: { "content-type": "application/pdf", "content-length": String(twoPagePdf.byteLength) } }),
    ]);

    const result = await readWeb({
      sessionDir,
      url: "https://publisher.example/large.pdf",
      fetcher: mock.fetcher,
      mineruApiToken: "token",
      firecrawlApiKey: "test-key",
      maxPdfPagesForMineru: 1,
      resolveHost: async () => ["93.184.216.34"],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "pdf_too_large" } });
    if (!result.ok) expect(result.error.message).toContain("navigation preview only");
    expect(mock.calls.map((call) => call.input)).toEqual(["https://publisher.example/large.pdf"]);
  });

  it("uses an internal source library before network readers", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const libraryDir = await mkdtemp(path.join(os.tmpdir(), "ebm-library-"));
    await mkdir(path.join(libraryDir, "kdigo-2024-ckd"), { recursive: true });
    await writeFile(path.join(libraryDir, "kdigo-2024-ckd", "metadata.json"), JSON.stringify({
      title: "KDIGO 2024 CKD Guideline",
      source_url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
    }));
    await writeFile(path.join(libraryDir, "kdigo-2024-ckd", "full.md"), "# KDIGO 2024 CKD Guideline\n\nCached recommendation.");
    const mock = mockFetch([]);

    const result = await readWeb({
      sessionDir,
      url: "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
      fetcher: mock.fetcher,
      sourceLibraryDir: libraryDir,
    });

    expect(result).toMatchObject({ ok: true, provider: "library" });
    expect(mock.calls).toHaveLength(0);
  });

  it("extracts a focused PDF page range with pdf-lib before MinerU upload", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([200, 200]);
    sourcePdf.addPage([200, 200]);
    const pdfBytes = await sourcePdf.save();
    const parsedArchive = zipSync({ "result/full.md": strToU8("# Focused pages\n\nPage range evidence.") });
    const mock = mockFetch([
      new Response(Buffer.from(pdfBytes), { headers: { "content-type": "application/pdf", "content-length": String(pdfBytes.byteLength) } }),
      Response.json({ data: { batch_id: "batch-1", file_urls: ["https://upload.example/signed"] } }),
      new Response(null, { status: 200 }),
      Response.json({ data: { extract_result: [{ state: "done", full_zip_url: "https://cdn.example/result.zip" }] } }),
      new Response(parsedArchive),
    ]);

    const result = await readWeb({
      sessionDir,
      url: "https://publisher.example/long-guideline.pdf",
      fetcher: mock.fetcher,
      mineruApiToken: "token",
      maxPdfPagesForMineru: 1,
      pdfPages: "1-1",
      resolveHost: async () => ["93.184.216.34"],
    });

    expect(result).toMatchObject({ ok: true, provider: "mineru" });
    const uploadRequest = JSON.parse(String(mock.calls[1]!.init?.body)) as { files: Array<{ name: string }> };
    expect(uploadRequest.files[0]!.name).toBe("pages-1-1-long-guideline.pdf");
  });

  it("downloads and uploads a PDF when Premium URL parsing cannot fetch it", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-web-"));
    const parsedArchive = zipSync({ "result/full.md": strToU8("# Uploaded clinical guideline\n\nRecovered PDF evidence.") });
    const mock = mockFetch([
      new Response("MinerU cannot fetch origin", { status: 502 }),
      new Response(new TextEncoder().encode("%PDF-1.7 source bytes"), { headers: { "content-type": "application/pdf" } }),
      Response.json({ data: { batch_id: "batch-1", file_urls: ["https://upload.example/signed"] } }),
      new Response(null, { status: 200 }),
      Response.json({ data: { extract_result: [{ state: "done", full_zip_url: "https://cdn.example/result.zip" }] } }),
      new Response(parsedArchive),
    ]);

    const result = await readWeb({
      sessionDir,
      url: "https://publisher.example/download/guideline.pdf",
      fetcher: mock.fetcher,
      mineruApiToken: "token",
      resolveHost: async () => ["93.184.216.34"],
    });

    expect(result).toMatchObject({ ok: true, provider: "mineru" });
    if (!result.ok) return;
    expect(result.archive.path).toBe("sources/read/uploaded-clinical-guideline/full.md");
    expect(result.archive.content).toContain("Recovered PDF evidence.");
    expect(mock.calls.map((call) => call.input)).toEqual([
      "https://mineru.net/api/v4/extract/task",
      "https://publisher.example/download/guideline.pdf",
      "https://mineru.net/api/v4/file-urls/batch",
      "https://upload.example/signed",
      "https://mineru.net/api/v4/extract-results/batch/batch-1",
      "https://cdn.example/result.zip",
    ]);
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

  it("searches Tavily and archives candidate summaries without quota data", async () => {
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
    expect(result.candidates).toEqual([{ title: "Trial", url: "https://example.org/trial", summary: "Trial abstract", score: 0.91 }]);
    expect(result.archive.content).toContain("Summary: Trial abstract");
    expect(result.archive.content).not.toContain("credits");
    expect(result.archive.content).not.toContain("response_time");
    expect(await readFile(path.join(sessionDir, result.archive.path), "utf8")).toContain(result.archive.content);
  });

  it("renders web search tool output as candidates only, not archive TOC or preview", () => {
    const longSummary = "important summary ".repeat(200);
    const text = renderSearchCandidatesText({
      query: "thyroid diagnosis",
      archivePath: "sources/search/thyroid.md",
      readablePath: "data/sessions/s1/sources/search/thyroid.md",
      candidates: [{ title: "Guideline", url: "https://example.org/guideline", score: 0.8, summary: longSummary }],
    });
    expect(text).toContain("Discovery archive path: sources/search/thyroid.md");
    expect(text).toContain(`Summary: ${longSummary}`);
    expect(text).not.toContain("Source map");
    expect(text).not.toContain("Preview:");
    expect(text).not.toContain("Read any archive window");
  });
});
