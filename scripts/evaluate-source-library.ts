import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { searchSourceLibrary } from "../src/tools/sourceLibrary.js";

type EvalCase = {
  name: string;
  query: string;
  expect_any: string[];
  max_rank: number;
  source?: "gold" | "runtime";
};

type LibraryMetadata = {
  title?: unknown;
  source_url?: unknown;
  aliases?: unknown;
  discovery_queries?: unknown;
  imported_at?: unknown;
  last_seen_at?: unknown;
  last_used_at?: unknown;
};

const root = process.cwd();
const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || path.join("data", "source_library", "guidelines");
const args = new Set(process.argv.slice(2));
const casesPathArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const casesPath = casesPathArg || path.join("scripts", "source-library-eval-cases.json");
const includeRuntime = !args.has("--gold-only");
const strictRuntime = args.has("--strict-runtime");
const runtimeLimit = Number(process.argv.slice(2).find((arg) => arg.startsWith("--runtime-limit="))?.slice("--runtime-limit=".length)) || 50;
const runtimeMaxRank = Number(process.argv.slice(2).find((arg) => arg.startsWith("--runtime-max-rank="))?.slice("--runtime-max-rank=".length)) || 5;

function candidateText(candidate: { title: string; sourceUrl?: string; aliases: string[]; snippet?: string }): string {
  return [candidate.title, candidate.sourceUrl, ...candidate.aliases, candidate.snippet].filter(Boolean).join("\n").toLowerCase();
}

function metadataTime(metadata: LibraryMetadata): number {
  const value = [metadata.last_used_at, metadata.last_seen_at, metadata.imported_at].find((item): item is string => typeof item === "string" && item.trim().length > 0);
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

async function loadGoldCases(): Promise<EvalCase[]> {
  const cases = JSON.parse(await readFile(path.join(root, casesPath), "utf8")) as EvalCase[];
  return cases.map((item) => ({ ...item, source: "gold" }));
}

async function loadRuntimeCases(): Promise<EvalCase[]> {
  const entries = await readdir(path.join(root, sourceLibraryDir), { withFileTypes: true }).catch(() => []);
  const candidates = [] as Array<{ metadata: LibraryMetadata; slug: string; time: number }>;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const metadata = JSON.parse(await readFile(path.join(root, sourceLibraryDir, entry.name, "metadata.json"), "utf8")) as LibraryMetadata;
      if (!Array.isArray(metadata.discovery_queries) || !metadata.discovery_queries.length) continue;
      candidates.push({ metadata, slug: entry.name, time: metadataTime(metadata) });
    } catch {
      continue;
    }
  }
  candidates.sort((a, b) => b.time - a.time || a.slug.localeCompare(b.slug));
  return candidates.slice(0, runtimeLimit).flatMap(({ metadata, slug }): EvalCase[] => {
    const title = typeof metadata.title === "string" ? metadata.title : slug;
    const sourceUrl = typeof metadata.source_url === "string" ? metadata.source_url : undefined;
    const aliases = Array.isArray(metadata.aliases) ? metadata.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    const queries = Array.isArray(metadata.discovery_queries) ? metadata.discovery_queries.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    const expectations = [sourceUrl, title, ...aliases, slug].filter((item): item is string => Boolean(item));
    return queries.slice(0, 3).map((query) => ({
      name: `runtime:${slug}`,
      query,
      expect_any: expectations,
      max_rank: runtimeMaxRank,
      source: "runtime",
    }));
  });
}

const cases = [...await loadGoldCases(), ...(includeRuntime ? await loadRuntimeCases() : [])];
let passed = 0;
let goldPassed = 0;
let goldTotal = 0;
let runtimePassed = 0;
let runtimeTotal = 0;
const runtimeRanks: number[] = [];
const runtimeWorst: Array<{ name: string; query: string; rank: number | undefined }> = [];
const reports: string[] = [];
for (const item of cases) {
  const results = await searchSourceLibrary({ sourceLibraryDir, query: item.query, limit: Math.max(item.max_rank, 10) });
  const rank = results.findIndex((candidate) => item.expect_any.some((expected) => candidateText(candidate).includes(expected.toLowerCase()))) + 1;
  const ok = rank > 0 && rank <= item.max_rank;
  if (ok) passed += 1;
  if (item.source === "runtime") {
    runtimeTotal += 1;
    if (ok) runtimePassed += 1;
    if (rank > 0) runtimeRanks.push(rank);
    if (!ok) runtimeWorst.push({ name: item.name, query: item.query, rank: rank || undefined });
  } else {
    goldTotal += 1;
    if (ok) goldPassed += 1;
  }
  reports.push([
    `${ok ? "PASS" : "FAIL"} [${item.source ?? "gold"}] ${item.name}`,
    `  query: ${item.query}`,
    `  expected any: ${item.expect_any.slice(0, 4).join(" | ")}${item.expect_any.length > 4 ? " | ..." : ""} within rank ${item.max_rank}`,
    `  observed rank: ${rank || "not found"}`,
    ...results.slice(0, Math.min(5, results.length)).map((candidate, index) => `  ${index + 1}. score=${candidate.score} ${candidate.title}${candidate.sourceUrl ? ` <${candidate.sourceUrl}>` : ""}`),
  ].join("\n"));
}

console.log(reports.join("\n\n"));
const sortedRuntimeRanks = [...runtimeRanks].sort((a, b) => a - b);
const medianRuntimeRank = sortedRuntimeRanks.length ? sortedRuntimeRanks[Math.floor(sortedRuntimeRanks.length / 2)] : undefined;
const p90RuntimeRank = sortedRuntimeRanks.length ? sortedRuntimeRanks[Math.min(sortedRuntimeRanks.length - 1, Math.floor(sortedRuntimeRanks.length * 0.9))] : undefined;
console.log(`\nSummary: gold ${goldPassed}/${goldTotal}, runtime ${runtimePassed}/${runtimeTotal}${strictRuntime ? " strict" : " soft"}`);
if (runtimeTotal) {
  console.log(`Runtime drift: recall@${runtimeMaxRank}=${(runtimePassed / runtimeTotal).toFixed(3)}, median_rank=${medianRuntimeRank ?? "n/a"}, p90_rank=${p90RuntimeRank ?? "n/a"}`);
  if (runtimeWorst.length) {
    console.log("Runtime worst cases:");
    for (const item of runtimeWorst.slice(0, 10)) console.log(`- ${item.name}: rank=${item.rank ?? "not found"}; query=${item.query}`);
  }
}
if (goldPassed !== goldTotal || (strictRuntime && runtimePassed !== runtimeTotal)) process.exitCode = 1;
