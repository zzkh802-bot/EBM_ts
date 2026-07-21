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

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

await main();
