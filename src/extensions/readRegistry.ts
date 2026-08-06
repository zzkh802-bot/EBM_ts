import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SourceArchiveRecord } from "../tools/archive.js";
import { listReadReceipts, registerReadReceipt } from "../tools/readRegistry.js";
import { piSessionDirectory } from "./sessionPath.js";

function textContent(event: ToolResultEvent): string {
  return event.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
}

export function formatReadReceipt(receipt: { id: string; lineStart: number; lineEnd: number }): string {
  return `\n\n[read_id: ${receipt.id}; absolute source lines ${receipt.lineStart}-${receipt.lineEnd} (not read-window-relative). With this ID, provide start_text/end_text; source_path is optional. line_start/line_end are optional absolute-line narrowing hints only—if they came from another candidate/read, omit them. If boundaries do not match, choose more distinctive anchors or reread a narrower window; the whole read range will not be used as an automatic fallback. Without this ID, use source_path + line_start/line_end.]`;
}

/** Register the exact visible window returned by an archive-backed read tool. */
export async function registerArchiveReadReceipt(input: {
  sessionDir: string;
  archive: Pick<SourceArchiveRecord, "path" | "bodyLineStart" | "lines">;
  lineStart: number;
  lineEnd: number;
}) {
  const source = await readFile(path.join(input.sessionDir, input.archive.path), "utf8");
  const sourceLineCount = source.split("\n").length;
  const lineStart = Math.max(input.archive.bodyLineStart, Math.min(input.lineStart, sourceLineCount));
  const lineEnd = Math.max(lineStart, Math.min(input.lineEnd, input.archive.bodyLineStart + input.archive.lines - 1, sourceLineCount));
  return registerReadReceipt({ sessionDir: input.sessionDir, sourcePath: input.archive.path, source, lineStart, lineEnd });
}

function sourceRelativePath(cwd: string, sessionDir: string, rawPath: string): string | undefined {
  const absolute = path.resolve(cwd, rawPath);
  const relative = path.relative(path.resolve(sessionDir), absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return relative.replaceAll("\\", "/");
}

function visibleLineEnd(text: string, sourceLineCount: number, startLine: number, input: Record<string, unknown>, details: unknown): number {
  const range = text.match(/Showing lines\s+(\d+)-(\d+)\s+of\s+\d+/i);
  if (range) return Number(range[2]);
  const truncation = details && typeof details === "object" ? (details as Record<string, unknown>).truncation : undefined;
  const outputLines = truncation && typeof truncation === "object" ? (truncation as Record<string, unknown>).outputLines : undefined;
  if (typeof outputLines === "number" && outputLines > 0) return Math.min(sourceLineCount, startLine + outputLines - 1);
  const limit = input.limit;
  if (typeof limit === "number" && limit > 0) return Math.min(sourceLineCount, startLine + limit - 1);
  return sourceLineCount;
}

export function registerReadRegistry(pi: Pick<ExtensionAPI, "registerTool" | "on">): void {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read" || event.isError) return;
    const input = event.input as Record<string, unknown>;
    const rawPath = typeof input.path === "string" ? input.path : undefined;
    if (!rawPath) return;
    const sessionDir = piSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId());
    const sourcePath = sourceRelativePath(ctx.cwd, sessionDir, rawPath);
    if (!sourcePath || !sourcePath.startsWith("sources/read/") || sourcePath.endsWith("/toc.md")) return;
    const source = await readFile(path.join(sessionDir, sourcePath), "utf8");
    const startLine = typeof input.offset === "number" && input.offset > 0 ? Math.floor(input.offset) : 1;
    const endLine = visibleLineEnd(event.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n"), source.split("\n").length, startLine, input, event.details);
    const receipt = await registerReadReceipt({ sessionDir, sourcePath, source, lineStart: startLine, lineEnd: endLine });
    const text = textContent(event);
    return {
      content: [...event.content, { type: "text", text: formatReadReceipt(receipt) }],
      details: { ...(event.details && typeof event.details === "object" ? event.details : {}), readId: receipt.id, sourcePath, sourceLines: [receipt.lineStart, receipt.lineEnd], sourcePreview: receipt.preview, originalTextChars: text.length },
    };
  });

  pi.registerTool({
    name: "read_list",
    label: "List Read Receipts",
    description: "List archived read receipts from the current session with source paths, line ranges, and two-line previews so read_id values and their required text anchors can be recovered before evidence_add.",
    promptSnippet: "Recover read IDs and their source previews",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionDir = piSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId());
      const receipts = await listReadReceipts(sessionDir);
      const text = receipts.length
        ? receipts.flatMap((receipt) => [
          `${receipt.id} · ${receipt.sourcePath} · absolute source L${receipt.lineStart}-${receipt.lineEnd}`,
          ...receipt.preview.map((line) => `${line.line}│${line.text}`),
          "",
        ]).join("\n").trim()
        : "No read receipts found in this session.";
      return { content: [{ type: "text", text }], details: { receipts } };
    },
  });
}
