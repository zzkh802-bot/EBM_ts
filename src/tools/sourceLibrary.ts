import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { archiveSource, stableArchiveName, type SourceArchiveRecord } from "./archive.js";
import { expandSourceLibraryQueryTerms } from "./sourceLibraryTerms.js";

const DEFAULT_SOURCE_LIBRARY_MAX_ENTRIES = 2000;

export type SourceLibraryCandidate = {
  slug: string;
  title: string;
  sourceUrl?: string;
  aliases: string[];
  score: number;
  snippet?: string;
};

type SourceLibraryMetadata = {
  title?: unknown;
  source_url?: unknown;
  aliases?: unknown;
  keywords?: unknown;
  organization?: unknown;
  year?: unknown;
  pmid?: unknown;
  pmcid?: unknown;
  doi?: unknown;
  publication_types?: unknown;
  provider?: unknown;
  source_status?: unknown;
  discovery_queries?: unknown;
};

function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
  const expansions = expandSourceLibraryQueryTerms(normalized);
  return uniqueStrings([...tokens, ...expansions]).filter((token) => token.length >= 2);
}

function sourceLibrarySlug(value: string): string {
  return stableArchiveName({ kind: "read", title: value, content: value }).replace(/\.md$/, "");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function markdownField(content: string, field: string): string | undefined {
  return content.match(new RegExp(`^${field}:\\s*(.+)$`, "mi"))?.[1]?.trim();
}

function sourceUrlIdentifiers(sourceUrl?: string): { pmid?: string; pmcid?: string; doi?: string } {
  if (!sourceUrl) return {};
  const pmid = sourceUrl.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1];
  const pmcid = sourceUrl.match(/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)/i)?.[1];
  const doi = sourceUrl.match(/doi\.org\/([^?#]+)/i)?.[1];
  return { ...(pmid ? { pmid } : {}), ...(pmcid ? { pmcid } : {}), ...(doi ? { doi: decodeURIComponent(doi) } : {}) };
}

function inferYear(input: { content: string; title?: string; sourceUrl?: string }): string | undefined {
  const journalLine = markdownField(input.content, "Journal");
  const candidates = [journalLine, input.title, input.sourceUrl, input.content.slice(0, 3000)].filter(Boolean).join(" ");
  return candidates.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
}

function inferPublicationTypes(content: string): string[] {
  const raw = markdownField(content, "Publication types") ?? markdownField(content, "Publication Types");
  if (!raw) return [];
  return uniqueStrings(raw.split(/[,;|]/));
}

function inferKeywords(input: { title: string; content: string; sourceUrl?: string; provider?: string; sourceStatus?: string; discoveryQuery?: string }): string[] {
  const ids = sourceUrlIdentifiers(input.sourceUrl);
  const fields = [
    input.title,
    markdownField(input.content, "PMID"),
    markdownField(input.content, "PMCID"),
    markdownField(input.content, "DOI"),
    markdownField(input.content, "Journal"),
    markdownField(input.content, "Publication types"),
    input.provider,
    input.sourceStatus,
    input.discoveryQuery,
    ids.pmid,
    ids.pmcid,
    ids.doi,
  ];
  const titleTokens = tokenize(input.title).filter((token) => token.length >= 3);
  const controlled = [
    /acute myeloid leukemia|\baml\b/iu.test(input.title) ? "AML acute myeloid leukemia 急性髓系白血病" : undefined,
    /cytarabine|ara-?c|阿糖胞苷/iu.test(input.title) ? "cytarabine Ara-C 阿糖胞苷" : undefined,
    /consolidation|postremission|巩固/iu.test(input.title) ? "consolidation postremission 巩固治疗 缓解后治疗" : undefined,
    /disease[- ]free survival|\bdfs\b|relapse[- ]free survival|\brfs\b|无病生存|无复发生存/iu.test(`${input.title} ${input.discoveryQuery ?? ""}`) ? "DFS disease-free survival RFS relapse-free survival 无病生存 无复发生存" : undefined,
    /overall survival|\bos\b|总生存/iu.test(`${input.title} ${input.discoveryQuery ?? ""}`) ? "OS overall survival 总生存" : undefined,
    /relapse|recurrence|复发/iu.test(`${input.title} ${input.discoveryQuery ?? ""}`) ? "relapse recurrence 复发" : undefined,
    /adverse event|toxicity|infection|不良反应|毒性|感染/iu.test(`${input.title} ${input.discoveryQuery ?? ""}`) ? "adverse events toxicity infection safety 严重不良反应 毒性 感染 安全性" : undefined,
    /random/i.test(input.title) ? "randomized trial RCT 随机对照试验" : undefined,
    /meta-analysis|systematic review/i.test(input.title) ? "meta-analysis systematic review 荟萃分析 系统综述" : undefined,
    /guideline|recommendation|指南|推荐/u.test(input.title) ? "guideline recommendation 指南 推荐" : undefined,
  ];
  return uniqueStrings([...fields, ...controlled, ...titleTokens]).slice(0, 80);
}

export function sourceLibraryMetadataFields(input: { title: string; sourceUrl?: string; content: string; provider: string; sourceStatus?: string; discoveryQuery?: string }) {
  const ids = sourceUrlIdentifiers(input.sourceUrl);
  const pmid = markdownField(input.content, "PMID") ?? ids.pmid;
  const pmcid = markdownField(input.content, "PMCID") ?? ids.pmcid;
  const doi = markdownField(input.content, "DOI") ?? ids.doi;
  const year = inferYear(input);
  const publicationTypes = inferPublicationTypes(input.content);
  return {
    ...(pmid ? { pmid } : {}),
    ...(pmcid ? { pmcid } : {}),
    ...(doi ? { doi } : {}),
    ...(year ? { year } : {}),
    ...(publicationTypes.length ? { publication_types: publicationTypes } : {}),
    keywords: inferKeywords(input),
    ...(input.discoveryQuery?.trim() ? { discovery_queries: [input.discoveryQuery.trim()] } : {}),
  };
}

function comparatorBonus(query: string, title: string): number {
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  const wantsHiDac = /high-dose|hidac|大剂量/.test(q);
  const wantsStandard = /standard-dose|标准剂量/.test(q);
  const wantsMultiagent = /multiagent|combination|多药/.test(q);
  let bonus = 0;
  if (wantsHiDac && /high-dose|hidac/.test(t)) bonus += 4;
  if (wantsStandard && /standard-dose/.test(t)) bonus += 8;
  if (wantsMultiagent && /multiagent|combination/.test(t)) bonus += 8;
  if (wantsHiDac && wantsStandard && wantsMultiagent && /high-dose/.test(t) && /standard-dose/.test(t) && /multiagent/.test(t)) bonus += 16;
  if ((/versus|相比|比较|对比/.test(q) || (wantsHiDac && wantsStandard)) && /versus|comparison|compared|randomized comparison/.test(t)) bonus += 8;
  return bonus;
}

function discoveryQueryBonus(query: string, discoveryQueries: string[]): number {
  if (!discoveryQueries.length) return 0;
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  let best = 0;
  for (const discoveryQuery of discoveryQueries) {
    const lower = discoveryQuery.toLowerCase();
    const matched = queryTokens.filter((token) => lower.includes(token)).length;
    const overlap = matched / queryTokens.length;
    const substringBonus = lower.includes(query.toLowerCase()) || query.toLowerCase().includes(lower) ? 20 : 0;
    best = Math.max(best, Math.round(overlap * 24) + matched * 2 + substringBonus);
  }
  return best;
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
      const metadata = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")) as SourceLibraryMetadata;
      const title = typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : entry.name;
      const aliases = Array.isArray(metadata.aliases) ? metadata.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const keywords = Array.isArray(metadata.keywords) ? metadata.keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const publicationTypes = Array.isArray(metadata.publication_types) ? metadata.publication_types.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const discoveryQueries = Array.isArray(metadata.discovery_queries) ? metadata.discovery_queries.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const highValueHaystack = [title, ...aliases, ...keywords, ...publicationTypes, ...discoveryQueries, metadata.organization, metadata.year, metadata.pmid, metadata.pmcid, metadata.doi, metadata.provider, metadata.source_status]
        .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
        .join(" ")
        .toLowerCase();
      let score = queryTokens.reduce((sum, token) => sum + (highValueHaystack.includes(token) ? 3 : 0), 0) + comparatorBonus(input.query, title) + discoveryQueryBonus(input.query, discoveryQueries);
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

function sourceLibraryMaxEntries(): number {
  const value = Number(process.env.SOURCE_LIBRARY_MAX_ENTRIES ?? "");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_SOURCE_LIBRARY_MAX_ENTRIES;
}

function metadataTime(metadata: Record<string, unknown>): number {
  const value = [metadata.last_used_at, metadata.last_seen_at, metadata.updated_at, metadata.imported_at].find((item): item is string => typeof item === "string" && item.trim().length > 0);
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function metadataAccessCount(metadata: Record<string, unknown>): number {
  const value = Number(metadata.access_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function pruneSourceLibrary(sourceLibraryDir: string, maxEntries: number): Promise<void> {
  const entries = (await sourceLibraryEntries(sourceLibraryDir)).filter((entry) => entry.isDirectory());
  if (entries.length < maxEntries) return;
  const candidates = await Promise.all(entries.map(async (entry) => {
    try {
      const metadata = JSON.parse(await readFile(path.join(sourceLibraryDir, entry.name, "metadata.json"), "utf8")) as Record<string, unknown>;
      return { name: entry.name, accessCount: metadataAccessCount(metadata), time: metadataTime(metadata) };
    } catch {
      return { name: entry.name, accessCount: 0, time: 0 };
    }
  }));
  candidates.sort((a, b) => a.accessCount - b.accessCount || a.time - b.time || a.name.localeCompare(b.name));
  for (const candidate of candidates.slice(0, Math.max(0, entries.length - maxEntries + 1))) {
    await rm(path.join(sourceLibraryDir, candidate.name), { recursive: true, force: true });
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
  discoveryQuery?: string;
}): Promise<{ written: boolean; updated?: boolean; path?: string }> {
  if (!input.sourceLibraryDir) return { written: false };
  if (!input.archive.content.trim()) return { written: false };
  await mkdir(input.sourceLibraryDir, { recursive: true });
  const entries = await sourceLibraryEntries(input.sourceLibraryDir);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const metadataPath = path.join(input.sourceLibraryDir, entry.name, "metadata.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as SourceLibraryMetadata & { sha256?: unknown };
      if ((input.archive.sourceUrl && metadata.source_url === input.archive.sourceUrl) || metadata.sha256 === input.archive.sha256) {
        const existingQueries = Array.isArray(metadata.discovery_queries) ? metadata.discovery_queries.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
        const discoveryQueries = input.discoveryQuery?.trim() && !existingQueries.includes(input.discoveryQuery.trim()) ? [...existingQueries, input.discoveryQuery.trim()] : existingQueries;
        const existingKeywords = Array.isArray(metadata.keywords) ? metadata.keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
        const incomingKeywords = input.discoveryQuery ? tokenize(input.discoveryQuery).filter((token) => token.length >= 3) : [];
        const fullPath = path.join(input.sourceLibraryDir, entry.name, "full.md");
        let contentUpdated = false;
        try {
          const existingContent = await readFile(fullPath, "utf8");
          if (input.archive.content.trim().length > existingContent.trim().length) {
            await writeFile(fullPath, `${input.archive.content.trim()}\n`, "utf8");
            contentUpdated = true;
          }
        } catch {
          await writeFile(fullPath, `${input.archive.content.trim()}\n`, "utf8");
          contentUpdated = true;
        }
        const updatedMetadata = {
          ...metadata,
          title: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title : input.archive.title || path.basename(input.archive.path, ".md"),
          ...(discoveryQueries.length ? { discovery_queries: discoveryQueries } : {}),
          keywords: uniqueStrings([...existingKeywords, ...incomingKeywords]),
          sha256: contentUpdated ? input.archive.sha256 : metadata.sha256,
          access_count: metadataAccessCount(metadata) + 1,
          last_seen_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          ...(contentUpdated ? { updated_at: new Date().toISOString(), updated_from: input.archive.path } : {}),
        };
        await writeFile(metadataPath, `${JSON.stringify(updatedMetadata, null, 2)}\n`, "utf8");
        return { written: false, updated: contentUpdated || discoveryQueries.length !== existingQueries.length, path: path.posix.join(input.sourceLibraryDir, entry.name) };
      }
    } catch {
      continue;
    }
  }

  await pruneSourceLibrary(input.sourceLibraryDir, sourceLibraryMaxEntries());
  const freshEntries = await sourceLibraryEntries(input.sourceLibraryDir);
  const baseSlug = sourceLibrarySlug(input.archive.title || input.archive.sourceUrl || input.archive.path || input.archive.sha256.slice(0, 12));
  let slug = baseSlug;
  for (let suffix = 1; freshEntries.some((entry) => entry.name === slug); suffix += 1) slug = `${baseSlug}-${suffix}`;
  const dir = path.join(input.sourceLibraryDir, slug);
  await mkdir(dir, { recursive: true });
  const title = input.archive.title || path.basename(input.archive.path, ".md");
  await writeFile(path.join(dir, "full.md"), `${input.archive.content.trim()}\n`, "utf8");
  await writeFile(path.join(dir, "metadata.json"), `${JSON.stringify({
    title,
    ...(input.archive.sourceUrl ? { source_url: input.archive.sourceUrl } : {}),
    aliases: aliasesFor({ title, ...(input.archive.sourceUrl ? { sourceUrl: input.archive.sourceUrl } : {}), archivePath: input.archive.path }),
    ...sourceLibraryMetadataFields({ title, ...(input.archive.sourceUrl ? { sourceUrl: input.archive.sourceUrl } : {}), content: input.archive.content, provider: input.provider, ...(input.sourceStatus ? { sourceStatus: input.sourceStatus } : {}), ...(input.discoveryQuery ? { discoveryQuery: input.discoveryQuery } : {}) }),
    sha256: input.archive.sha256,
    provider: input.provider,
    access_count: 1,
    last_used_at: new Date().toISOString(),
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
      const metadataPath = path.join(dir, "metadata.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { source_url?: unknown; title?: unknown } & Record<string, unknown>;
      if (metadata.source_url !== input.url) continue;
      const content = await readFile(path.join(dir, "full.md"), "utf8");
      if (!content.trim()) continue;
      await writeFile(metadataPath, `${JSON.stringify({
        ...metadata,
        access_count: metadataAccessCount(metadata) + 1,
        last_used_at: new Date().toISOString(),
      }, null, 2)}\n`, "utf8");
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
