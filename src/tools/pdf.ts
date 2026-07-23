import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export function pdfFileName(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
    return /^[^/\\]+\.pdf$/i.test(name) ? name : "document.pdf";
  } catch {
    return "document.pdf";
  }
}

export async function estimatePdfPages(bytes: Uint8Array): Promise<number | undefined> {
  try {
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    const text = new TextDecoder("latin1").decode(bytes);
    const pages = text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    return pages > 0 ? pages : undefined;
  }
}

export function parsePdfPageRange(value: string): { start: number; end: number } {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(trimmed);
  if (!match) throw new Error("pdf_pages must be a page number or range like 1-5");
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error("pdf_pages must be a positive ascending range");
  if (end - start + 1 > 25) throw new Error("pdf_pages may include at most 25 pages");
  return { start, end };
}

export async function extractPdfPages(bytes: Uint8Array, rangeValue: string): Promise<Uint8Array> {
  const range = parsePdfPageRange(rangeValue);
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  if (range.end > pageCount) throw new Error(`pdf_pages ends at ${range.end}, but PDF has only ${pageCount} pages`);
  const output = await PDFDocument.create();
  const indexes = Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start - 1 + index);
  const pages = await output.copyPages(source, indexes);
  for (const page of pages) output.addPage(page);
  return await output.save();
}

export async function pdfNavigationPreview(bytes: Uint8Array, maxPages = 8): Promise<string> {
  try {
    const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
    const metadata = await doc.getMetadata().catch(() => undefined) as { info?: { Title?: unknown } } | undefined;
    const outline = await doc.getOutline().catch(() => undefined);
    const lines = [
      `PDF pages: ${doc.numPages}`,
      ...(typeof metadata?.info?.Title === "string" && metadata.info.Title.trim() ? [`PDF title: ${metadata.info.Title.trim()}`] : []),
    ];
    const outlineTitles = outline?.map((item: { title?: unknown }) => typeof item.title === "string" ? item.title.trim() : "").filter(Boolean).slice(0, 12) ?? [];
    if (outlineTitles.length) lines.push("PDF outline/bookmarks:", ...outlineTitles.map((title, index) => `- ${index + 1}. ${title}`));
    lines.push(`First ${Math.min(maxPages, doc.numPages)} page text preview:`);
    for (let pageNumber = 1; pageNumber <= Math.min(maxPages, doc.numPages); pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => "str" in item && typeof item.str === "string" ? item.str : "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 900);
      if (text) lines.push(`Page ${pageNumber}: ${text}`);
    }
    return lines.join("\n");
  } catch (error) {
    return `PDF navigation preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}
