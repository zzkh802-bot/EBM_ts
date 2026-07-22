import { describe, expect, it, vi } from "vitest";
import { downloadOpenAccessPdf, resolveOpenAlexPdf } from "../src/tools/openAlex.js";

function mockFetch(responses: Response[]) {
  return vi.fn(async () => responses.shift() ?? new Response("unexpected request", { status: 500 })) as unknown as typeof fetch;
}

describe("OpenAlex OA resolver", () => {
  it("selects an OA PDF location for an exact PMID", async () => {
    const fetcher = mockFetch([Response.json({
      id: "https://openalex.org/W1",
      doi: "https://doi.org/10.1/example",
      locations: [
        { is_oa: true, landing_page_url: "https://publisher.example/article", pdf_url: null, source: { display_name: "Publisher" } },
        { is_oa: true, landing_page_url: "https://repository.example/item", pdf_url: "https://repository.example/article.pdf", source: { display_name: "Repository" } },
      ],
    })]);
    const result = await resolveOpenAlexPdf({ pmid: "123", fetcher });
    expect(result).toEqual({
      workId: "https://openalex.org/W1",
      doi: "https://doi.org/10.1/example",
      pdfUrl: "https://repository.example/article.pdf",
      landingPageUrl: "https://repository.example/item",
      sourceName: "Repository",
    });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("works/pmid%3A123"), expect.anything());
  });

  it("downloads a bounded PDF while validating each redirect", async () => {
    const fetcher = mockFetch([
      new Response(null, { status: 302, headers: { location: "https://cdn.example/article.pdf" } }),
      new Response(new TextEncoder().encode("%PDF-1.7 clinical content"), { headers: { "content-type": "application/pdf" } }),
    ]);
    const result = await downloadOpenAccessPdf({
      url: "https://repository.example/download",
      fetcher,
      resolveHost: async () => ["93.184.216.34"],
    });
    expect(new TextDecoder().decode(result.bytes)).toContain("%PDF-1.7");
    expect(result.finalUrl).toBe("https://cdn.example/article.pdf");
  });

  it("blocks redirects to private addresses before downloading them", async () => {
    const fetcher = mockFetch([new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.pdf" } })]);
    await expect(downloadOpenAccessPdf({
      url: "https://repository.example/download",
      fetcher,
      resolveHost: async (host) => host === "repository.example" ? ["93.184.216.34"] : ["127.0.0.1"],
    })).rejects.toThrow(/private/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns undefined rather than treating a landing page as full text", async () => {
    const fetcher = mockFetch([Response.json({ id: "https://openalex.org/W1", locations: [{ is_oa: true, landing_page_url: "https://example.org/article", pdf_url: null }] })]);
    await expect(resolveOpenAlexPdf({ pmid: "123", fetcher })).resolves.toBeUndefined();
  });
});
