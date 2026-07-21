import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeMarkdown } from "./markdown.js";

export type SourceArchiveInput = {
  sessionDir: string;
  kind: "search" | "read" | "upload";
  sourceUrl?: string;
  title?: string;
  content: string;
};

export type SourceArchiveRecord = {
  path: string;
  sha256: string;
  chars: number;
  lines: number;
  bodyLineOffset: number;
  content: string;
  sourceUrl?: string;
  title?: string;
};

export function stableArchiveName(input: Pick<SourceArchiveInput, "kind" | "sourceUrl" | "title" | "content">): string {
  const seed = [input.kind, input.sourceUrl ?? "", input.title ?? "", input.content.slice(0, 4096)].join("\u001f");
  return `${input.kind}-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}.md`;
}

export async function archiveSource(input: SourceArchiveInput): Promise<SourceArchiveRecord> {
  const content = normalizeMarkdown(input.content);
  const normalizedInput = { ...input, content };
  const sha256 = createHash("sha256").update(content).digest("hex");
  const rel = path.posix.join("sources", input.kind, stableArchiveName(normalizedInput));
  const abs = path.join(input.sessionDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const frontmatter = [
    "---",
    `kind: ${input.kind}`,
    `sha256: ${sha256}`,
    ...(input.sourceUrl ? [`source_url: ${JSON.stringify(input.sourceUrl)}`] : []),
    ...(input.title ? [`title: ${JSON.stringify(input.title)}`] : []),
    "---",
  ].join("\n") + "\n\n";
  await writeFile(abs, `${frontmatter}${content}`, "utf8");
  const bodyLineOffset = (frontmatter.match(/\n/g) ?? []).length;
  return {
    path: rel,
    sha256,
    chars: content.length,
    lines: content.split("\n").length,
    bodyLineOffset,
    content,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.title ? { title: input.title } : {}),
  };
}
