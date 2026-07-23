import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";

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
