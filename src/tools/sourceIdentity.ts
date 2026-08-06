import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type SourceIdentity = {
  documentId: string;
  sourceId: string;
};

export type ArchivedSourceIdentity = SourceIdentity & { path: string };

const sessionSources = new Map<string, Map<string, ArchivedSourceIdentity>>();

function hashId(prefix: "doc" | "src", value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function canonicalLocator(value: string, includeFragment: boolean): string {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    if (!includeFragment) url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return includeFragment ? value.trim() : value.replace(/#.*$/, "").trim();
  }
}

export function sourceIdentity(input: {
  sha256: string;
  sourceUrl?: string;
  sourceInstitution?: string;
  title?: string;
}): SourceIdentity {
  const title = input.title?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";
  const institution = input.sourceInstitution?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";
  const documentKey = input.sourceUrl
    ? `url:${canonicalLocator(input.sourceUrl, false)}`
    : `metadata:${institution}\u0000${title || input.sha256}`;
  const documentId = hashId("doc", documentKey);
  const sourceLocator = input.sourceUrl ? canonicalLocator(input.sourceUrl, true) : documentKey;
  return {
    documentId,
    sourceId: hashId("src", `${documentId}\u0000${sourceLocator}\u0000${input.sha256}`),
  };
}

export function registerArchivedSource(sessionDir: string, sourcePath: string, identity: SourceIdentity): void {
  const key = path.resolve(sessionDir);
  const sources = sessionSources.get(key) ?? new Map<string, ArchivedSourceIdentity>();
  sources.set(identity.sourceId, { ...identity, path: sourcePath.replaceAll("\\", "/") });
  sessionSources.set(key, sources);
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const line = frontmatter.split("\n").find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) return undefined;
  const value = line.slice(key.length + 1).trim();
  if (!value) return undefined;
  try {
    return value.startsWith('"') ? JSON.parse(value) as string : value;
  } catch {
    return value;
  }
}

function archivedIdentity(markdown: string): SourceIdentity | undefined {
  if (!markdown.startsWith("---\n")) {
    return sourceIdentity({ sha256: createHash("sha256").update(markdown).digest("hex") });
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return undefined;
  const frontmatter = markdown.slice(4, end);
  const body = markdown.slice(end + 5).replace(/^\n/, "");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const sourceUrl = frontmatterValue(frontmatter, "source_url");
  const sourceInstitution = frontmatterValue(frontmatter, "source_institution");
  const title = frontmatterValue(frontmatter, "title");
  return sourceIdentity({ sha256, ...(sourceUrl ? { sourceUrl } : {}), ...(sourceInstitution ? { sourceInstitution } : {}), ...(title ? { title } : {}) });
}

async function markdownFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.name === ".metadata") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "toc.md") output.push(absolute);
  }
  return output;
}

async function scanSessionSources(sessionDir: string): Promise<Map<string, ArchivedSourceIdentity>> {
  const root = path.resolve(sessionDir);
  const sources = sessionSources.get(root) ?? new Map<string, ArchivedSourceIdentity>();
  for (const absolute of await markdownFiles(path.join(root, "sources", "read"))) {
    const markdown = await readFile(absolute, "utf8");
    const identity = archivedIdentity(markdown);
    if (!identity) continue;
    sources.set(identity.sourceId, { ...identity, path: path.relative(root, absolute).replaceAll("\\", "/") });
  }
  sessionSources.set(root, sources);
  return sources;
}

export async function resolveSourceId(sessionDir: string, sourceId: string): Promise<ArchivedSourceIdentity> {
  if (!/^src_[a-f0-9]{16}$/.test(sourceId)) throw new Error("invalid source_id");
  const root = path.resolve(sessionDir);
  const cached = sessionSources.get(root)?.get(sourceId);
  if (cached) return cached;
  const resolved = (await scanSessionSources(root)).get(sourceId);
  if (!resolved) throw new Error(`source_id was not found in this session: ${sourceId}`);
  return resolved;
}

export async function sourceIdentityForPath(sessionDir: string, sourcePath: string): Promise<ArchivedSourceIdentity> {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) throw new Error("unsafe source path");
  const markdown = await readFile(path.join(sessionDir, normalized), "utf8");
  const identity = archivedIdentity(markdown);
  if (!identity) throw new Error("archived source identity cannot be derived");
  registerArchivedSource(sessionDir, normalized, identity);
  return { ...identity, path: normalized };
}
