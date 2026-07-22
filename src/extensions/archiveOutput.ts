import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { SourceArchiveRecord } from "../tools/archive.js";

const READ_PREVIEW_BYTES = 5_000;
const MAP_MAX_ITEMS = 20;

export function readableArchivePath(sessionId: string, sourcePath: string): string {
  return ["data", "sessions", sessionId, sourcePath].join("/");
}

export function archiveDetails(record: SourceArchiveRecord): Omit<SourceArchiveRecord, "content"> {
  const { content: _content, ...details } = record;
  return details;
}

function sourceMap(content: string, bodyLineStart: number): string[] {
  const items: string[] = [];
  content.split("\n").forEach((line, index) => {
    const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (!match || items.length >= MAP_MAX_ITEMS) return;
    items.push(`- ${match[1]} ${match[2]} — line ${bodyLineStart + index}`);
  });
  return items;
}

export function archiveToolText(
  record: SourceArchiveRecord,
  readablePath = record.path,
  options: { compactRead?: boolean } = {},
): { text: string; truncated: boolean } {
  const previewBytes = options.compactRead ? READ_PREVIEW_BYTES : DEFAULT_MAX_BYTES;
  const excerpt = truncateHead(record.content, {
    maxBytes: previewBytes,
    maxLines: DEFAULT_MAX_LINES,
  });
  const visibleStart = record.bodyLineStart;
  const visibleEnd = visibleStart + excerpt.content.split("\n").length - 1;
  const totalLines = record.bodyLineStart + record.lines - 1;
  const map = options.compactRead ? sourceMap(record.content, record.bodyLineStart) : [];
  return {
    text: [
      `Evidence source_path: ${record.path}`,
      `Readable archive path: ${readablePath}`,
      `Archive lines: 1-${totalLines} (${totalLines} total lines; 1-based).`,
      `Visible preview maps to lines ${visibleStart}-${visibleEnd}.`,
      `Read more with read(path=${JSON.stringify(readablePath)}, offset=N, limit=M); use the same 1-based offset/limit with evidence_add.`,
      ...(map.length ? ["", "Source map:", ...map] : []),
      "",
      "Preview:",
      "",
      excerpt.content,
      ...(excerpt.truncated ? [
        "",
        `[Preview truncated at ${previewBytes} bytes; full normalized source remains at ${readablePath}.]`,
      ] : []),
    ].join("\n"),
    truncated: excerpt.truncated,
  };
}
