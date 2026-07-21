import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

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
  sourceUrl?: string;
  title?: string;
};

export function stableArchiveName(input: Pick<SourceArchiveInput, "kind" | "sourceUrl" | "title" | "content">): string {
  const seed = [input.kind, input.sourceUrl ?? "", input.title ?? "", input.content.slice(0, 4096)].join("\u001f");
  return `${input.kind}-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}.md`;
}

export async function archiveSource(input: SourceArchiveInput): Promise<SourceArchiveRecord> {
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const rel = path.posix.join("sources", input.kind, stableArchiveName(input));
  const abs = path.join(input.sessionDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  const frontmatter = [
    "---",
    `kind: ${input.kind}`,
    `sha256: ${sha256}`,
    input.sourceUrl ? `source_url: ${JSON.stringify(input.sourceUrl)}` : undefined,
    input.title ? `title: ${JSON.stringify(input.title)}` : undefined,
    "---",
    "",
  ].filter(Boolean).join("\n");
  await writeFile(abs, `${frontmatter}${input.content}`, "utf8");
  return {
    path: rel,
    sha256,
    chars: input.content.length,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.title ? { title: input.title } : {}),
  };
}
