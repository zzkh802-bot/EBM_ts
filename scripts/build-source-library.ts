import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceLibraryMetadataFields } from "../src/tools/sourceLibrary.js";

type Frontmatter = {
  kind?: string;
  sha256?: string;
  source_url?: string;
  title?: string;
};

type Candidate = {
  sourcePath: string;
  session: string;
  slug: string;
  title: string;
  sourceUrl?: string;
  sha256: string;
  content: string;
  aliases: string[];
};

const root = process.cwd();
const sessionsDir = path.join(root, "data", "sessions");
const libraryDir = path.join(root, process.env.SOURCE_LIBRARY_DIR || path.join("data", "source_library", "guidelines"));

function parseArgs(): { reset: boolean; limit?: number } {
  const args = process.argv.slice(2);
  const parsedLimit = Number(args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length));
  return {
    reset: args.includes("--reset"),
    ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
  };
}

function semanticSlug(value: string): string {
  const normalized = value.normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const chars = Array.from(normalized);
  if (chars.length <= 76) return normalized || "source";
  const clipped = chars.slice(0, 76).join("").replace(/-$/g, "");
  const boundary = clipped.lastIndexOf("-");
  return boundary >= 50 ? clipped.slice(0, boundary) : clipped;
}

function parseFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
  if (!markdown.startsWith("---\n")) return { frontmatter: {}, body: markdown };
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: markdown };
  const raw = markdown.slice(4, end).split(/\r?\n/);
  const frontmatter: Frontmatter = {};
  for (const line of raw) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim() as keyof Frontmatter;
    const value = line.slice(index + 1).trim();
    if (!["kind", "sha256", "source_url", "title"].includes(key)) continue;
    try {
      frontmatter[key] = JSON.parse(value);
    } catch {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: markdown.slice(end + "\n---\n".length) };
}

function firstTitle(body: string, fallback: string): string {
  return body.split(/\r?\n/).map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim()).find(Boolean) || fallback;
}

function aliasesFor(candidate: Pick<Candidate, "title" | "sourceUrl" | "slug">): string[] {
  const aliases = new Set<string>();
  aliases.add(candidate.slug.replace(/-/g, " "));
  if (candidate.sourceUrl) {
    try {
      const url = new URL(candidate.sourceUrl);
      aliases.add(url.hostname.replace(/^www\./, ""));
      const leaf = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "").replace(/\.[a-z0-9]{1,8}$/i, "");
      if (leaf) aliases.add(leaf.replace(/[-_]+/g, " "));
    } catch {
      // ignore invalid archival source URLs
    }
  }
  for (const token of candidate.title.split(/[：:—–-]/).map((item) => item.trim()).filter(Boolean)) aliases.add(token);
  return [...aliases].filter((item) => item && item !== candidate.title).slice(0, 12);
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(abs));
    else files.push(abs);
  }
  return files;
}

async function collectCandidates(limit?: number): Promise<Candidate[]> {
  const files = (await walk(sessionsDir))
    .filter((file) => file.includes(`${path.sep}sources${path.sep}read${path.sep}`))
    .filter((file) => file.endsWith(".md") && !file.endsWith(`${path.sep}toc.md`));
  const byKey = new Map<string, Candidate>();
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const content = body.trim();
    if (content.length < 500) continue;
    const sha256 = typeof frontmatter.sha256 === "string" ? frontmatter.sha256 : createHash("sha256").update(content).digest("hex");
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const session = relative.split("/")[2] || "unknown-session";
    const sourceUrl = typeof frontmatter.source_url === "string" ? frontmatter.source_url : undefined;
    const title = typeof frontmatter.title === "string" && frontmatter.title.trim() ? frontmatter.title.trim() : firstTitle(content, path.basename(file, ".md"));
    const key = sourceUrl || sha256;
    const existing = byKey.get(key);
    if (existing && existing.content.length >= content.length) continue;
    const baseSlug = semanticSlug(title || sourceUrl || sha256.slice(0, 12));
    byKey.set(key, {
      sourcePath: relative,
      session,
      slug: baseSlug,
      title,
      ...(sourceUrl ? { sourceUrl } : {}),
      sha256,
      content,
      aliases: [],
    });
  }
  const candidates = [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title));
  for (const candidate of candidates) candidate.aliases = aliasesFor(candidate);
  return limit ? candidates.slice(0, limit) : candidates;
}

async function uniqueDirName(base: string, used: Set<string>): Promise<string> {
  let name = base || "source";
  for (let suffix = 1; used.has(name); suffix += 1) name = `${base}-${suffix}`;
  used.add(name);
  return name;
}

async function main(): Promise<void> {
  const { reset, limit } = parseArgs();
  await mkdir(libraryDir, { recursive: true });
  if (reset) {
    const entries = await readdir(libraryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "README.md") continue;
      await rm(path.join(libraryDir, entry.name), { recursive: true, force: true });
    }
  }
  const candidates = await collectCandidates(limit);
  const used = new Set<string>();
  const written: Array<Candidate & { librarySlug: string }> = [];
  for (const candidate of candidates) {
    const librarySlug = await uniqueDirName(candidate.slug, used);
    const dir = path.join(libraryDir, librarySlug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "full.md"), `${candidate.content.trim()}\n`, "utf8");
    const provider = candidate.sourceUrl?.includes("pubmed.ncbi.nlm.nih.gov") || candidate.sourceUrl?.includes("pmc.ncbi.nlm.nih.gov") ? "pubmed" : candidate.sourceUrl?.startsWith("mcp://") ? "guideline_mcp" : "archive";
    await writeFile(path.join(dir, "metadata.json"), `${JSON.stringify({
      title: candidate.title,
      ...(candidate.sourceUrl ? { source_url: candidate.sourceUrl } : {}),
      aliases: candidate.aliases,
      ...sourceLibraryMetadataFields({ title: candidate.title, ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}), content: candidate.content, provider }),
      sha256: candidate.sha256,
      provider,
      imported_from: candidate.sourcePath,
      imported_session: candidate.session,
      imported_at: new Date().toISOString(),
      import_method: "scripts/build-source-library.ts",
    }, null, 2)}\n`, "utf8");
    written.push({ ...candidate, librarySlug });
  }
  const index = [
    "# Local Source Library Index",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Entries: ${written.length}`,
    "",
    ...written.map((item, index) => `${index + 1}. **${item.title}** — \`${item.librarySlug}\`${item.sourceUrl ? ` — ${item.sourceUrl}` : ""}`),
    "",
  ].join("\n");
  await writeFile(path.join(libraryDir, "INDEX.md"), index, "utf8");
  console.log(JSON.stringify({ libraryDir: path.relative(root, libraryDir), entries: written.length, index: path.relative(root, path.join(libraryDir, "INDEX.md")) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
