import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { archiveSource, stableArchiveName, type SourceArchiveRecord } from "./archive.js";

export type SourceLibraryCandidate = {
  slug: string;
  title: string;
  sourceUrl?: string;
  aliases: string[];
  score: number;
  snippet?: string;
};

function tokenize(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
}

function sourceLibrarySlug(value: string): string {
  return stableArchiveName({ kind: "read", title: value, content: value }).replace(/\.md$/, "");
}

function snippetFor(content: string, tokens: string[]): string | undefined {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const found = lines.find((line) => tokens.some((token) => line.toLowerCase().includes(token)));
  return found?.slice(0, 500);
}

export async function searchSourceLibrary(input: { sourceLibraryDir?: string; query: string; limit?: number }): Promise<SourceLibraryCandidate[]> {
  if (!input.sourceLibraryDir) return [];
  const queryTokens = tokenize(input.query);
  if (!queryTokens.length) return [];
  let entries;
  try {
    entries = await readdir(input.sourceLibraryDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: SourceLibraryCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(input.sourceLibraryDir, entry.name);
    try {
      const metadata = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")) as { title?: unknown; source_url?: unknown; aliases?: unknown; organization?: unknown; year?: unknown };
      const title = typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : entry.name;
      const aliases = Array.isArray(metadata.aliases) ? metadata.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const haystack = [title, ...aliases, metadata.organization, metadata.year].filter((item): item is string | number => typeof item === "string" || typeof item === "number").join(" ").toLowerCase();
      let score = queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 3 : 0), 0);
      let content = "";
      if (score < queryTokens.length * 3) {
        try {
          content = await readFile(path.join(dir, "full.md"), "utf8");
          const lower = content.toLowerCase();
          score += queryTokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
        } catch {
          content = "";
        }
      }
      if (score <= 0) continue;
      const snippet = content ? snippetFor(content, queryTokens) : undefined;
      candidates.push({
        slug: entry.name,
        title,
        ...(typeof metadata.source_url === "string" && metadata.source_url.trim() ? { sourceUrl: metadata.source_url.trim() } : {}),
        aliases,
        score,
        ...(snippet ? { snippet } : {}),
      });
    } catch {
      continue;
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, input.limit ?? 10);
}

async function sourceLibraryEntries(sourceLibraryDir: string) {
  try {
    return await readdir(sourceLibraryDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function aliasesFor(input: { title?: string; sourceUrl?: string; archivePath?: string }): string[] {
  const aliases = new Set<string>();
  if (input.archivePath) aliases.add(path.basename(path.dirname(input.archivePath)).replace(/-/g, " "));
  if (input.title) {
    for (const part of input.title.split(/[：:—–-]/).map((item) => item.trim()).filter(Boolean)) aliases.add(part);
  }
  if (input.sourceUrl) {
    try {
      const url = new URL(input.sourceUrl);
      aliases.add(url.hostname.replace(/^www\./, ""));
      const leaf = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "").replace(/\.[a-z0-9]{1,8}$/i, "");
      if (leaf) aliases.add(leaf.replace(/[-_]+/g, " "));
    } catch {
      // ignore invalid archived source URLs
    }
  }
  return [...aliases].filter((alias) => alias && alias !== input.title).slice(0, 12);
}

export async function upsertSourceLibraryFromArchive(input: {
  sourceLibraryDir?: string;
  archive: SourceArchiveRecord;
  provider: string;
  sessionId?: string;
  sourceStatus?: string;
}): Promise<{ written: boolean; path?: string }> {
  if (!input.sourceLibraryDir) return { written: false };
  if (!input.archive.content.trim()) return { written: false };
  await mkdir(input.sourceLibraryDir, { recursive: true });
  const entries = await sourceLibraryEntries(input.sourceLibraryDir);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const metadata = JSON.parse(await readFile(path.join(input.sourceLibraryDir, entry.name, "metadata.json"), "utf8")) as { source_url?: unknown; sha256?: unknown };
      if ((input.archive.sourceUrl && metadata.source_url === input.archive.sourceUrl) || metadata.sha256 === input.archive.sha256) {
        return { written: false, path: path.posix.join(input.sourceLibraryDir, entry.name) };
      }
    } catch {
      continue;
    }
  }

  const baseSlug = sourceLibrarySlug(input.archive.title || input.archive.sourceUrl || input.archive.path || input.archive.sha256.slice(0, 12));
  let slug = baseSlug;
  for (let suffix = 1; entries.some((entry) => entry.name === slug); suffix += 1) slug = `${baseSlug}-${suffix}`;
  const dir = path.join(input.sourceLibraryDir, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "full.md"), `${input.archive.content.trim()}\n`, "utf8");
  await writeFile(path.join(dir, "metadata.json"), `${JSON.stringify({
    title: input.archive.title || path.basename(input.archive.path, ".md"),
    ...(input.archive.sourceUrl ? { source_url: input.archive.sourceUrl } : {}),
    aliases: aliasesFor({ ...(input.archive.title ? { title: input.archive.title } : {}), ...(input.archive.sourceUrl ? { sourceUrl: input.archive.sourceUrl } : {}), archivePath: input.archive.path }),
    sha256: input.archive.sha256,
    provider: input.provider,
    ...(input.sourceStatus ? { source_status: input.sourceStatus } : {}),
    ...(input.sessionId ? { imported_session: input.sessionId } : {}),
    imported_from: input.archive.path,
    imported_at: new Date().toISOString(),
    import_method: "automatic_read_archive_upsert",
  }, null, 2)}\n`, "utf8");
  return { written: true, path: path.posix.join(input.sourceLibraryDir, slug) };
}

export async function readFromSourceLibrary(input: { sessionDir: string; sourceLibraryDir?: string; url: string }): Promise<SourceArchiveRecord | undefined> {
  if (!input.sourceLibraryDir) return undefined;
  let entries;
  try {
    entries = await readdir(input.sourceLibraryDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(input.sourceLibraryDir, entry.name);
    try {
      const metadata = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")) as { source_url?: unknown; title?: unknown };
      if (metadata.source_url !== input.url) continue;
      const content = await readFile(path.join(dir, "full.md"), "utf8");
      if (!content.trim()) continue;
      return archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        sourceUrl: input.url,
        ...(typeof metadata.title === "string" && metadata.title.trim() ? { title: metadata.title } : {}),
        content,
      });
    } catch {
      continue;
    }
  }
  return undefined;
}
