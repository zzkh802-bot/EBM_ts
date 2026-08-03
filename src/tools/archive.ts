import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { preprocessExternalContent, type ExternalContentFormat } from "./markdown.js";
import { registerArchivedSource, sourceIdentity } from "./sourceIdentity.js";

export type SourceArchiveResource = {
  path: string;
  bytes: Uint8Array;
  mediaType?: string;
};

export type SourceArchiveInput = {
  sessionDir: string;
  kind: "search" | "read" | "upload";
  layout?: "directory" | "file";
  sourceUrl?: string;
  sourceInstitution?: string;
  title?: string;
  archiveName?: string;
  content: string;
  contentFormat?: ExternalContentFormat;
  resources?: SourceArchiveResource[];
};

export type SourceArchiveRecord = {
  path: string;
  archiveDir?: string;
  tocPath?: string;
  resourcePaths?: string[];
  sha256: string;
  chars: number;
  lines: number;
  bodyLineStart: number;
  content: string;
  documentId: string;
  sourceId: string;
  sourceUrl?: string;
  sourceInstitution?: string;
  title?: string;
};

function semanticSlug(value: string): string {
  const normalized = value.normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const chars = Array.from(normalized);
  if (chars.length <= 76) return normalized;
  const clipped = chars.slice(0, 76).join("").replace(/-$/g, "");
  const boundary = clipped.lastIndexOf("-");
  return boundary >= 50 ? clipped.slice(0, boundary) : clipped;
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

export function stableArchiveName(input: Pick<SourceArchiveInput, "kind" | "sourceUrl" | "title" | "archiveName" | "content">): string {
  const firstReadableLine = input.content.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  const stem = semanticSlug(input.archiveName || input.title || urlSemanticName(input.sourceUrl) || firstReadableLine || `${input.kind}-source`);
  return `${stem || `${input.kind}-source`}.md`;
}

function frontmatter(input: SourceArchiveInput, sha256: string): string {
  return `${[
    "---",
    `kind: ${input.kind}`,
    `sha256: ${sha256}`,
    ...(input.sourceUrl ? [`source_url: ${JSON.stringify(input.sourceUrl)}`] : []),
    ...(input.sourceInstitution ? [`source_institution: ${JSON.stringify(input.sourceInstitution)}`] : []),
    ...(input.title ? [`title: ${JSON.stringify(input.title)}`] : []),
    "---",
  ].join("\n")}\n\n`;
}

function headingInfo(line: string): { level: number; title: string } | undefined {
  const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
  return match ? { level: match[1]!.length, title: match[2]!.trim() } : undefined;
}

function renderToc(sourcePath: string, content: string, bodyLineStart: number): string {
  const lines = content.split("\n");
  const headings = lines.flatMap((line, index) => {
    const heading = headingInfo(line);
    return heading ? [{ ...heading, index }] : [];
  });
  const output = [
    "# Source Index",
    "",
    `- Source: \`${sourcePath}\``,
    `- Total lines: ${bodyLineStart + lines.length - 1}`,
    "- Line numbering: 1-based",
    "",
    "## Sections",
    "",
  ];
  if (!headings.length) return [...output, "- No Markdown headings detected.", ""].join("\n");
  headings.forEach((heading, position) => {
    let endIndex = lines.length - 1;
    for (const next of headings.slice(position + 1)) {
      if (next.level <= heading.level) {
        endIndex = next.index - 1;
        break;
      }
    }
    const start = bodyLineStart + heading.index;
    const end = bodyLineStart + endIndex;
    const preview = lines.slice(heading.index + 1, Math.min(endIndex + 1, heading.index + 8)).map((line) => line.trim()).find((line) => line && !headingInfo(line));
    output.push(`${"  ".repeat(Math.max(0, heading.level - 1))}- H${heading.level} ${heading.title} — lines ${start}-${Math.max(start, end)}`);
    if (preview) output.push(`${"  ".repeat(heading.level)}Preview: ${preview.slice(0, 200)}`);
  });
  return `${output.join("\n")}\n`;
}

async function archiveSearchFile(input: SourceArchiveInput, archived: string, baseName: string): Promise<string> {
  const outDir = path.join(input.sessionDir, "sources", "search");
  await mkdir(outDir, { recursive: true });
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const abs = path.join(outDir, name);
    try {
      await writeFile(abs, archived, { encoding: "utf8", flag: "wx" });
      return path.posix.join("sources", "search", name);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (await readFile(abs, "utf8") === archived) return path.posix.join("sources", "search", name);
    }
  }
}

function safeResourcePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe archive resource path: ${value}`);
  }
  if (["full.md", "toc.md"].includes(normalized) || normalized.startsWith(".metadata/")) throw new Error(`reserved archive resource path: ${value}`);
  return normalized;
}

function resourceManifest(resources: SourceArchiveResource[]): Array<{ path: string; media_type?: string; bytes: number; sha256: string }> {
  return resources.map((resource) => ({
    path: safeResourcePath(resource.path),
    ...(resource.mediaType ? { media_type: resource.mediaType } : {}),
    bytes: resource.bytes.byteLength,
    sha256: createHash("sha256").update(resource.bytes).digest("hex"),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

async function archivedResourcesMatch(absDir: string, resources: SourceArchiveResource[]): Promise<boolean> {
  const expected = resourceManifest(resources);
  if (!expected.length) return true;
  const parsed = JSON.parse(await readFile(path.join(absDir, ".metadata", "resources.json"), "utf8")) as { resources?: unknown };
  if (!Array.isArray(parsed.resources)) return false;
  return JSON.stringify(parsed.resources) === JSON.stringify(expected);
}

async function writeArchiveResources(absDir: string, resources: SourceArchiveResource[]): Promise<string[]> {
  const manifest = resourceManifest(resources);
  if (!manifest.length) return [];
  for (const resource of resources) {
    const rel = safeResourcePath(resource.path);
    const abs = path.join(absDir, ...rel.split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, resource.bytes, { flag: "wx" });
  }
  await mkdir(path.join(absDir, ".metadata"), { recursive: true });
  await writeFile(path.join(absDir, ".metadata", "resources.json"), `${JSON.stringify({ version: 1, resources: manifest }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return manifest.map((item) => item.path);
}

async function archiveReadFile(input: SourceArchiveInput, archived: string, baseName: string): Promise<{ path: string }> {
  if (input.resources?.length) throw new Error("flat read archives cannot contain resources");
  const outDir = path.join(input.sessionDir, "sources", input.kind);
  await mkdir(outDir, { recursive: true });
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const abs = path.join(outDir, name);
    try {
      await writeFile(abs, archived, { encoding: "utf8", flag: "wx" });
      return { path: path.posix.join("sources", input.kind, name) };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (await readFile(abs, "utf8") === archived) return { path: path.posix.join("sources", input.kind, name) };
    }
  }
}

async function archiveReadDirectory(input: SourceArchiveInput, archived: string, baseName: string, bodyLineStart: number): Promise<{ path: string; archiveDir: string; tocPath: string; resourcePaths?: string[] }> {
  const outRoot = path.join(input.sessionDir, "sources", input.kind);
  await mkdir(outRoot, { recursive: true });
  for (let suffix = 1; ; suffix += 1) {
    const dirName = `${baseName}${suffix === 1 ? "" : `-${suffix}`}`;
    const absDir = path.join(outRoot, dirName);
    const archiveDir = path.posix.join("sources", input.kind, dirName);
    const sourcePath = path.posix.join(archiveDir, "full.md");
    const tocPath = path.posix.join(archiveDir, "toc.md");
    try {
      await mkdir(absDir);
      await writeFile(path.join(absDir, "full.md"), archived, { encoding: "utf8", flag: "wx" });
      await writeFile(path.join(absDir, "toc.md"), renderToc(sourcePath, input.content, bodyLineStart), { encoding: "utf8", flag: "wx" });
      const resourcePaths = await writeArchiveResources(absDir, input.resources ?? []);
      return { path: sourcePath, archiveDir, tocPath, ...(resourcePaths.length ? { resourcePaths } : {}) };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      try {
        if (await readFile(path.join(absDir, "full.md"), "utf8") === archived && await archivedResourcesMatch(absDir, input.resources ?? [])) {
          const resourcePaths = resourceManifest(input.resources ?? []).map((resource) => resource.path);
          return { path: sourcePath, archiveDir, tocPath, ...(resourcePaths.length ? { resourcePaths } : {}) };
        }
      } catch {
        // A partially-created or unrelated directory is a collision; try the next suffix.
      }
    }
  }
}

export async function archiveSource(input: SourceArchiveInput): Promise<SourceArchiveRecord> {
  const content = preprocessExternalContent(input.content, input.contentFormat ? { format: input.contentFormat } : {});
  const normalizedInput = { ...input, content };
  const sha256 = createHash("sha256").update(content).digest("hex");
  const baseName = stableArchiveName(normalizedInput).replace(/\.md$/, "");
  const metadata = frontmatter(normalizedInput, sha256);
  const archived = `${metadata}${content}`;
  const bodyLineStart = (metadata.match(/\n/g) ?? []).length + 1;
  const location = input.kind === "search"
    ? { path: await archiveSearchFile(normalizedInput, archived, baseName) }
    : input.layout === "file"
      ? await archiveReadFile(normalizedInput, archived, baseName)
      : await archiveReadDirectory(normalizedInput, archived, baseName, bodyLineStart);
  const identity = sourceIdentity({
    sha256,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.sourceInstitution ? { sourceInstitution: input.sourceInstitution } : {}),
    ...(input.title ? { title: input.title } : {}),
  });
  registerArchivedSource(input.sessionDir, location.path, identity);
  return {
    ...location,
    ...identity,
    sha256,
    chars: content.length,
    lines: content.split("\n").length,
    bodyLineStart,
    content,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.sourceInstitution ? { sourceInstitution: input.sourceInstitution } : {}),
    ...(input.title ? { title: input.title } : {}),
  };
}
