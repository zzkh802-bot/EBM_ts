import { NodeHtmlMarkdown, type TranslatorConfigObject } from "node-html-markdown";

export type MarkdownNormalizationOptions = {
  maxLineLength?: number;
};

export type ExternalContentFormat = "auto" | "html" | "markdown" | "plain" | "xml";

export type ExternalContentPreprocessOptions = MarkdownNormalizationOptions & {
  format?: ExternalContentFormat;
};

const DEFAULT_MAX_LINE_LENGTH = 200;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const MARKUP_DOCUMENT_START = /^\s*(?:<!doctype\s+html|<\?xml\b|<(?:html|body|article)\b)/i;
const MARKUP_TAG = /<\/?(?:a|article|aside|b|blockquote|body|br|caption|dd|div|dl|dt|em|fig|figcaption|figure|graphic|h[1-6]|head|html|i|img|li|list|list-item|main|ol|p|s|sec|section|strong|sub|sup|table|table-wrap|tbody|td|tfoot|th|thead|title|tr|u|ul)\b[^>]*>/gi;
const MARKDOWN_BLOCK = /^\s{0,3}(?:#{1,6}\s|```|~~~|(?:[-+*]|\d+[.)])\s|>\s|\|.*\|\s*$)/m;
const MERGED_TABLE_CELL = /<(?:td|th)\b[^>]*(?:rowspan|colspan)\s*=\s*["']?(?:[2-9]|\d{2,})\b/i;
const TABLE_LAYOUT_WARNING = "> 表格含合并单元格；Markdown 已保留可读文字，但行列关系需回原文核验。";

const MARKUP_TRANSLATORS: TranslatorConfigObject = {
  "graphic,img": ({ node }) => {
    const label = [node.getAttribute("alt"), node.getAttribute("title")]
      .find((value) => value?.trim())
      ?.replace(/[\[\]\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    return {
      content: `[图像：${label || "未提供可读说明"}]`,
      recurse: false,
    };
  },
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

export function cleanExternalText(input: string): string {
  let output = input;
  for (let pass = 0; pass < 2; pass += 1) output = decodeEntities(output);
  return output
    .normalize("NFC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2000-\u200A\u202F]/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function decodeTransportLineBreaks(input: string): string {
  if (/^\s*```|^\s*~~~/m.test(input)) return input;
  const escapedBreaks = input.match(/\\(?:r\\n|[rn])/g)?.length ?? 0;
  const realBreaks = input.match(/\n/g)?.length ?? 0;
  // A lone `\n` is common in paths and code. Repeated escapes with almost no
  // physical line breaks are the signature of a transport string encoded twice.
  if (escapedBreaks < 2 || realBreaks > 1) return input;
  return input.replace(/\\r\\n|\\n|\\r/g, "\n");
}

function detectedContentFormat(input: string): Exclude<ExternalContentFormat, "auto"> {
  if (MARKUP_DOCUMENT_START.test(input)) return /^\s*<\?xml\b/i.test(input) ? "xml" : "html";
  if (MARKDOWN_BLOCK.test(input)) return "markdown";
  const tags = input.match(MARKUP_TAG) ?? [];
  if (tags.length < 4) return "plain";
  return tags.some((tag) => /^<\/?(?:sec|title|list|list-item|table-wrap|graphic)\b/i.test(tag)) ? "xml" : "html";
}

function xmlVocabularyToHtml(input: string): string {
  return input
    .replace(/<\/?\?xml[^>]*>/gi, "")
    .replace(/<(\/?)sec\b/gi, "<$1section")
    .replace(/<title\b([^>]*)>/gi, "<h2$1>")
    .replace(/<\/title>/gi, "</h2>")
    .replace(/<(\/?)list-item\b/gi, "<$1li")
    .replace(/<list\b[^>]*>/gi, "<ul>")
    .replace(/<\/list>/gi, "</ul>")
    .replace(/<(\/?)table-wrap(?:-foot)?\b/gi, "<$1section")
    .replace(/<(\/?)disp-quote\b/gi, "<$1blockquote");
}

function markupToMarkdown(input: string, format: "html" | "xml"): string {
  const source = format === "xml" ? xmlVocabularyToHtml(input) : input;
  const converted = NodeHtmlMarkdown.translate(source, {
    keepDataImages: false,
    maxConsecutiveNewlines: 3,
    useInlineLinks: true,
  }, MARKUP_TRANSLATORS);
  return MERGED_TABLE_CELL.test(source) ? `${TABLE_LAYOUT_WARNING}\n\n${converted}` : converted;
}

/**
 * Prepare untrusted network/document text for both the model and its canonical
 * archive. Transformations are deliberately layout-only: this function never
 * guesses missing OCR characters, table cells, punctuation, numbers, or words.
 */
export function preprocessExternalContent(input: string, options: ExternalContentPreprocessOptions = {}): string {
  const transportDecoded = decodeTransportLineBreaks(cleanExternalText(input));
  const format = options.format === undefined || options.format === "auto"
    ? detectedContentFormat(transportDecoded)
    : options.format;
  const readable = format === "html" || format === "xml"
    ? markupToMarkdown(transportDecoded, format)
    : transportDecoded;
  return normalizeMarkdown(cleanExternalText(readable), options);
}

function wrapLine(line: string, maxLineLength: number): string[] {
  if (line.length <= maxLineLength) return [line];

  const words = line.split(" ");
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxLineLength) {
      current += ` ${word}`;
      continue;
    }
    output.push(current);
    current = word;
  }
  if (current) output.push(current);
  return output;
}

export function normalizeMarkdown(input: string, options: MarkdownNormalizationOptions = {}): string {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  if (!Number.isInteger(maxLineLength) || maxLineLength < 40) {
    throw new Error("maxLineLength must be an integer of at least 40");
  }

  const normalizedNewlines = input.replace(/\r\n?/g, "\n");
  const output: string[] = [];
  let fenceMarker: "```" | "~~~" | undefined;

  for (const line of normalizedNewlines.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const marker = trimmed.startsWith("```") ? "```" : "~~~";
      fenceMarker = fenceMarker === marker ? undefined : fenceMarker ?? marker;
      output.push(line);
      continue;
    }
    if (fenceMarker || /^\s*\|.*\|\s*$/.test(line)) {
      output.push(line);
      continue;
    }
    output.push(...wrapLine(line, maxLineLength));
  }

  return output.join("\n");
}
