export type MarkdownNormalizationOptions = {
  maxLineLength?: number;
};

const DEFAULT_MAX_LINE_LENGTH = 200;

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
