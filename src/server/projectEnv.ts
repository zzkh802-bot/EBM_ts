import { readFile } from "node:fs/promises";
import path from "node:path";

/** Read project-local environment values without exposing them in logs or errors. */
export async function loadProjectEnv(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path.join(rootDir, ".env"), "utf8");
    const values: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1] ?? "";
      const rawValue = match[2] ?? "";
      values[key] = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    }
    return values;
  } catch {
    return {};
  }
}
