export type MarkdownNormalizationOptions = {
  maxLineLength?: number;
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
