import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function semanticSlug(value: string): string {
  const normalized = value.normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return Array.from(normalized).slice(0, 96).join("").replace(/-$/g, "");
}

function urlSemanticName(sourceUrl?: string): string {
  if (!sourceUrl) return "";
  try {
    const url = new URL(sourceUrl);
    const basename = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/\.[a-z0-9]{1,8}$/i, "");
    return basename || url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function stableArchiveName(input: Pick<SourceArchiveInput, "kind" | "sourceUrl" | "title" | "content">): string {
  const firstReadableLine = input.content.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  const stem = semanticSlug(input.title || urlSemanticName(input.sourceUrl) || firstReadableLine || `${input.kind}-source`);
  return `${stem || `${input.kind}-source`}.md`;
}

export async function archiveSource(input: SourceArchiveInput): Promise<SourceArchiveRecord> {
  const content = normalizeMarkdown(input.content);
  const normalizedInput = { ...input, content };
  const sha256 = createHash("sha256").update(content).digest("hex");
  const baseName = stableArchiveName(normalizedInput).replace(/\.md$/, "");
  const outDir = path.join(input.sessionDir, "sources", input.kind);
  await mkdir(outDir, { recursive: true });
  const frontmatter = [
    "---",
    `kind: ${input.kind}`,
    `sha256: ${sha256}`,
    ...(input.sourceUrl ? [`source_url: ${JSON.stringify(input.sourceUrl)}`] : []),
    ...(input.title ? [`title: ${JSON.stringify(input.title)}`] : []),
    "---",
  ].join("\n") + "\n\n";
  const archived = `${frontmatter}${content}`;
  let rel = "";
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const abs = path.join(outDir, name);
    try {
      await writeFile(abs, archived, { encoding: "utf8", flag: "wx" });
      rel = path.posix.join("sources", input.kind, name);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (await readFile(abs, "utf8") === archived) {
        rel = path.posix.join("sources", input.kind, name);
        break;
      }
    }
  }
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
