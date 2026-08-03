import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const forbidden = [
  { file: "package.json", pattern: /sqlite|better-sqlite|sequelize|typeorm/i, reason: "foundation must not reintroduce SQL storage" },
  { file: "package.json", pattern: /langchain|llamaindex/i, reason: "avoid framework bloat in foundation" },
];

async function exists(file: string): Promise<boolean> {
  try { await readFile(path.join(root, file), "utf8"); return true; } catch { return false; }
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  }));
  return nested.flat();
}

function relativeModulePath(file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function resolveImport(file: string, specifier: string, knownFiles: Set<string>): string | undefined {
  const absolute = path.resolve(path.dirname(file), specifier);
  const candidates = [
    absolute,
    absolute.replace(/\.js$/, ".ts"),
    `${absolute}.ts`,
    path.join(absolute, "index.ts"),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate));
}

async function dependencyGraph(files: string[]): Promise<Map<string, string[]>> {
  const knownFiles = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const imports: string[] = [];
    for (const match of text.matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g)) {
      const resolved = resolveImport(file, match[1]!, knownFiles);
      if (resolved) imports.push(resolved);
    }
    graph.set(file, imports);
  }
  return graph;
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (node: string): void => {
    if (state.get(node) === "visited") return;
    if (state.get(node) === "visiting") {
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push([...stack.slice(start), node]);
      return;
    }
    state.set(node, "visiting");
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    stack.pop();
    state.set(node, "visited");
  };
  for (const file of graph.keys()) visit(file);
  return cycles;
}

async function main() {
  const failures: string[] = [];
  for (const rule of forbidden) {
    if (!(await exists(rule.file))) continue;
    const text = await readFile(path.join(root, rule.file), "utf8");
    if (rule.pattern.test(text)) failures.push(`${rule.file}: ${rule.reason}`);
  }

  const top = new Set(await readdir(root));
  for (const required of ["vendor", "src", "tests", "docs", ".pi"]) {
    if (!top.has(required)) failures.push(`missing required foundation directory: ${required}`);
  }

  const sourceFiles = await collectTypeScriptFiles(path.join(root, "src"));
  const graph = await dependencyGraph(sourceFiles);
  for (const [file, dependencies] of graph) {
    const source = relativeModulePath(file);
    for (const dependency of dependencies) {
      const target = relativeModulePath(dependency);
      if (source.startsWith("src/server/") && target.startsWith("src/extensions/")) {
        failures.push(`${source} -> ${target}: server modules must depend on core/session modules, not Pi extension adapters`);
      }
      if (source.startsWith("src/session/") && target.startsWith("src/extensions/")) {
        failures.push(`${source} -> ${target}: core session modules must not depend on extensions`);
      }
      if (source.startsWith("src/tools/") && target.startsWith("src/server/")) {
        failures.push(`${source} -> ${target}: domain tools must not depend on the HTTP/server layer`);
      }
      if (source.startsWith("src/extensions/") && target.startsWith("src/server/")) {
        failures.push(`${source} -> ${target}: Pi extensions must not depend on the HTTP/server layer`);
      }
    }
  }
  for (const cycle of findCycles(graph)) {
    failures.push(`circular dependency: ${cycle.map(relativeModulePath).join(" -> ")}`);
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

await main();
