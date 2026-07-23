import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Metadata = {
  title?: unknown;
  source_url?: unknown;
  aliases?: unknown;
  keywords?: unknown;
  pmid?: unknown;
  pmcid?: unknown;
};

const root = process.cwd();
const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || path.join("data", "source_library", "guidelines");
const maxEntries = Number(process.env.SOURCE_LIBRARY_MAX_ENTRIES ?? "") || 2000;

function line(slug: string, message: string): string {
  return `${slug}: ${message}`;
}

function badTitle(title: unknown): string | undefined {
  if (typeof title !== "string" || !title.trim()) return "missing title";
  const normalized = title.trim().toLowerCase();
  if (["full", "read-source", "markdown content"].includes(normalized)) return `weak title: ${title}`;
  if (/^title:\s+/i.test(title)) return `title still contains Title: prefix: ${title}`;
  if (/\.(?:pdf|html?|aspx?)$/i.test(normalized)) return `file-name-like title: ${title}`;
  if (/^https?[-:]/i.test(normalized)) return `url-like title: ${title}`;
  if (title.trim().length < 8) return `too-short title: ${title}`;
  return undefined;
}

const entries = await readdir(path.join(root, sourceLibraryDir), { withFileTypes: true }).catch(() => []);
const dirs = entries.filter((entry) => entry.isDirectory());
const issues: string[] = [];
const warnings: string[] = [];
if (dirs.length > maxEntries) issues.push(line(".", `entry count ${dirs.length} exceeds SOURCE_LIBRARY_MAX_ENTRIES=${maxEntries}`));

const seenUrls = new Map<string, string>();
for (const dirent of dirs) {
  const slug = dirent.name;
  const dir = path.join(root, sourceLibraryDir, slug);
  let metadata: Metadata;
  try {
    metadata = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")) as Metadata;
  } catch {
    issues.push(line(slug, "missing or invalid metadata.json"));
    continue;
  }
  const titleIssue = badTitle(metadata.title);
  if (titleIssue) issues.push(line(slug, titleIssue));
  const sourceUrl = typeof metadata.source_url === "string" ? metadata.source_url : undefined;
  if (sourceUrl) {
    const existing = seenUrls.get(sourceUrl);
    if (existing) issues.push(line(slug, `duplicate source_url also in ${existing}: ${sourceUrl}`));
    else seenUrls.set(sourceUrl, slug);
  }
  const aliases = Array.isArray(metadata.aliases) ? metadata.aliases : [];
  if (!aliases.length) warnings.push(line(slug, "missing aliases"));
  const keywords = Array.isArray(metadata.keywords) ? metadata.keywords : [];
  if (!keywords.length) warnings.push(line(slug, "missing keywords"));
  if (sourceUrl?.includes("pubmed.ncbi.nlm.nih.gov") && typeof metadata.pmid !== "string") issues.push(line(slug, "PubMed URL missing pmid"));
  if (sourceUrl?.includes("pmc.ncbi.nlm.nih.gov") && typeof metadata.pmcid !== "string") warnings.push(line(slug, "PMC URL missing pmcid"));
  let content = "";
  try {
    content = await readFile(path.join(dir, "full.md"), "utf8");
  } catch {
    issues.push(line(slug, "missing full.md"));
  }
  if (content && content.trim().length < 300) warnings.push(line(slug, "full.md is very short"));
}

console.log(`# Source library audit: ${issues.length ? "FAIL" : "PASS"}\n\nEntries: ${dirs.length}\nHard issues: ${issues.length}\nWarnings: ${warnings.length}\n`);
if (issues.length) {
  console.log("## Hard issues");
  for (const item of issues.slice(0, 200)) console.log(`- ${item}`);
  if (issues.length > 200) console.log(`- ... ${issues.length - 200} more issues`);
}
if (warnings.length) {
  console.log("\n## Warnings");
  for (const item of warnings.slice(0, 80)) console.log(`- ${item}`);
  if (warnings.length > 80) console.log(`- ... ${warnings.length - 80} more warnings`);
}
if (issues.length) process.exitCode = 1;
