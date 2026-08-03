import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { listReadReceipts, registerReadReceipt } from "../tools/readRegistry.js";
import { piSessionDirectory } from "./sessionPath.js";

function textContent(event: ToolResultEvent): string {
  return event.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
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
      content: [...event.content, { type: "text", text: `\n\n[read_id: ${receipt.id}; source lines ${receipt.lineStart}-${receipt.lineEnd}. Use this ID with evidence_add, or fall back to source_path + line_start/line_end.]` }],
      details: { ...(event.details && typeof event.details === "object" ? event.details : {}), readId: receipt.id, sourcePath, sourceLines: [receipt.lineStart, receipt.lineEnd], sourcePreview: receipt.preview, originalTextChars: text.length },
    };
  });

  pi.registerTool({
    name: "read_list",
    label: "List Read Receipts",
    description: "List archived read receipts from the current session with source paths, line ranges, and two-line previews so read_id values can be recovered before evidence_add.",
    promptSnippet: "Recover read IDs and their source previews",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionDir = piSessionDirectory(ctx.cwd, ctx.sessionManager.getSessionId());
      const receipts = await listReadReceipts(sessionDir);
      const text = receipts.length
        ? receipts.flatMap((receipt) => [
          `${receipt.id} · ${receipt.sourcePath} · L${receipt.lineStart}-${receipt.lineEnd}`,
          ...receipt.preview.map((line) => `${line.line}│${line.text}`),
          "",
        ]).join("\n").trim()
        : "No read receipts found in this session.";
      return { content: [{ type: "text", text }], details: { receipts } };
    },
  });
}
