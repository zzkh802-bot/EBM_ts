import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type ContextPruneOptions = {
  sessionFile: string;
  sessionDir: string;
  readableSessionWorkspace: string;
  maxPreviewChars?: number;
  minTextChars?: number;
};

export type ContextPruneResult = {
  pruned: number;
  archived: Array<{ entryId: string; toolName: string; path: string; originalChars: number }>;
};

const DEFAULT_PREVIEW_CHARS = 200;
const DEFAULT_MIN_TEXT_CHARS = 4_000;
const PRUNE_MARKER = "[EBM_CONTEXT_PRUNED]";

function textBlocks(content: unknown): Array<{ block: Record<string, unknown>; text: string }> {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const record = block as Record<string, unknown>;
    return record.type === "text" && typeof record.text === "string" ? [{ block: record, text: record.text }] : [];
  });
}

function archiveName(entryId: string, toolName: string, text: string): string {
  const slug = toolName.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "tool";
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 10);
  return `${entryId}-${slug}-${hash}.md`;
}

export async function pruneLargeToolResults(options: ContextPruneOptions): Promise<ContextPruneResult> {
  const maxPreviewChars = options.maxPreviewChars ?? DEFAULT_PREVIEW_CHARS;
  const minTextChars = options.minTextChars ?? DEFAULT_MIN_TEXT_CHARS;
  const raw = await readFile(options.sessionFile, "utf8");
  const lines = raw.split(/\n/);
  const archiveDir = path.join(options.sessionDir, "context_prune", "tool-results");
  const archived: ContextPruneResult["archived"] = [];
  let changed = false;
  const nextLines: string[] = [];

  await mkdir(archiveDir, { recursive: true, mode: 0o700 });

  for (const line of lines) {
    if (!line.trim()) {
      if (line) nextLines.push(line);
      continue;
    }
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      nextLines.push(line);
      continue;
    }
    if (entry?.type !== "message" || entry.message?.role !== "toolResult") {
      nextLines.push(JSON.stringify(entry));
      continue;
    }
    const blocks = textBlocks(entry.message.content);
    const largeBlocks = blocks.filter(({ text }) => text.length >= minTextChars && !text.includes(PRUNE_MARKER));
    if (!largeBlocks.length) {
      nextLines.push(JSON.stringify(entry));
      continue;
    }
    const original = largeBlocks.map(({ text }, index) => `## Text block ${index + 1}\n\n${text}`).join("\n\n---\n\n");
    const toolName = typeof entry.message.toolName === "string" ? entry.message.toolName : "tool";
    const fileName = archiveName(String(entry.id ?? "entry"), toolName, original);
    const relPath = path.posix.join("context_prune", "tool-results", fileName);
    const absPath = path.join(archiveDir, fileName);
    await writeFile(absPath, `${original}\n`, { encoding: "utf8", mode: 0o600 });
    const readablePath = `${options.readableSessionWorkspace}/${relPath}`;
    for (const { block, text } of largeBlocks) {
      const preview = Array.from(text).slice(0, maxPreviewChars).join("");
      block.text = [
        PRUNE_MARKER,
        `Tool result pruned after a completed interaction because context exceeded the EBM pruning threshold.`,
        `Tool: ${toolName}`,
        `Original characters: ${text.length}`,
        `Full archived result: ${readablePath}`,
        "",
        "Preview:",
        preview,
      ].join("\n");
    }
    archived.push({ entryId: String(entry.id ?? ""), toolName, path: relPath, originalChars: original.length });
    changed = true;
    nextLines.push(JSON.stringify(entry));
  }

  if (changed) {
    const tmp = `${options.sessionFile}.prune-${process.pid}-${Date.now()}.tmp`;
    await writeFile(tmp, `${nextLines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, options.sessionFile);
  }
  return { pruned: archived.length, archived };
}
