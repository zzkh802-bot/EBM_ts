import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { SourceArchiveRecord } from "../tools/archive.js";

const READ_PREVIEW_CHARS = 3_500;
const MAP_MAX_ITEMS = 20;

export type ArchiveToolTextResult = {
  text: string;
  truncated: boolean;
  visibleStart: number;
  visibleEnd: number;
};

function numberLines(content: string, startLine: number): string {
  return content.split("\n")
    .map((line, index) => `${String(startLine + index).padStart(5, " ")}│${line}`)
    .join("\n");
}

export function readableArchivePath(sessionId: string, sourcePath: string): string {
  return ["data", "sessions", sessionId, sourcePath].join("/");
}

export function archiveDetails(record: SourceArchiveRecord): Omit<SourceArchiveRecord, "content"> {
  const { content: _content, ...details } = record;
  return details;
}

function sourceMap(content: string, bodyLineStart: number): { items: string[]; total: number } {
  const headings = content.split("\n").flatMap((line, index) => {
    const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
    return match ? [{ line: `- ${match[1]} ${match[2]} — line ${bodyLineStart + index}` }] : [];
  });
  return { items: headings.slice(0, MAP_MAX_ITEMS).map((item) => item.line), total: headings.length };
}

function truncateCharacters(content: string, maxChars: number, maxLines: number): { content: string; truncated: boolean } {
  const characters = Array.from(content);
  const lineLimited = characters.slice(0, maxChars).join("").split("\n").slice(0, maxLines).join("\n");
  return { content: lineLimited, truncated: lineLimited.length < content.length };
}

export function archiveToolText(
  record: SourceArchiveRecord,
  readablePath = record.path,
  options: { compactRead?: boolean; citationEligible?: boolean } = {},
): ArchiveToolTextResult {
  const quickMode = process.env.EBM_RESEARCH_MODE === "quick";
  const sourceUseInstruction = quickMode
    ? "Quick mode: this readable, archived source may support the final answer only through its Source ID marker; do not create evidence records."
    : "After read, use the returned read_id with the absolute line_start/line_end from that same read (source_path is optional; never copy line numbers from another candidate or read). For an exact range of no more than 12 source lines, start_text/end_text may be omitted; broader read_id ranges need the shortest distinctive continuous anchors. Or use source_path with line_start/line_end (text anchors optional). Layout/XML/entity/punctuation noise is normalized. If read_id anchors do not match, choose more distinctive boundaries, use a tight matching range, or reread a narrower window; do not archive a broad whole read as a fallback.";
  const compactRead = options.compactRead === true;
  const previewLimit = compactRead ? READ_PREVIEW_CHARS : DEFAULT_MAX_BYTES;
  const excerpt = compactRead
    ? truncateCharacters(record.content, READ_PREVIEW_CHARS, DEFAULT_MAX_LINES)
    : truncateHead(record.content, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const visibleStart = record.bodyLineStart;
  const visibleEnd = visibleStart + excerpt.content.split("\n").length - 1;
  const totalLines = record.bodyLineStart + record.lines - 1;
  const map = options.compactRead ? sourceMap(record.content, record.bodyLineStart) : { items: [], total: 0 };
  const readablePrefix = readablePath.endsWith(record.path) ? readablePath.slice(0, -record.path.length) : "";
  const readableTocPath = record.tocPath && readablePrefix
    ? `${readablePrefix}${record.tocPath}`
    : record.tocPath;
  const readableResources = record.resourcePaths?.map((resourcePath) => record.archiveDir && readablePrefix
    ? `${readablePrefix}${record.archiveDir}/${resourcePath}`
    : resourcePath) ?? [];
  return {
    text: [
      `Readable archive path: ${readablePath}`,
      `Source ID: ${record.sourceId}`,
      ...(readableTocPath ? [`Readable source index: ${readableTocPath}`] : []),
      ...(readableResources.length ? [`Archived referenced resources: ${readableResources.join(", ")}`] : []),
      `Archive lines: 1-${totalLines} (${totalLines} total lines; 1-based).`,
      `Visible preview maps to absolute source lines ${visibleStart}-${visibleEnd}.`,
      `Read any archive window with read(path=${JSON.stringify(readablePath)}, offset=N, limit=M).`,
      ...(options.citationEligible === false
        ? [quickMode ? "This search snapshot is discovery-only and cannot be cited; read an individually archived sources/read document instead." : "This search snapshot is discovery history and cannot be passed to evidence_add; use an individually archived sources/read document."]
        : [sourceUseInstruction]),
      ...(excerpt.truncated ? [`Continue without gaps (the last preview line is intentionally repeated): read(path=${JSON.stringify(readablePath)}, offset=${Math.max(record.bodyLineStart, visibleEnd)}, limit=200).`] : []),
      ...(readableTocPath ? [`Read the complete section index with read(path=${JSON.stringify(readableTocPath)}).`] : []),
      ...(map.items.length ? ["", `Source map${map.total > map.items.length ? ` (first ${map.items.length} of ${map.total}; complete index is in toc.md)` : ""}:`, ...map.items] : []),
      "",
      "Preview:",
      "",
      numberLines(excerpt.content, visibleStart),
      ...(excerpt.truncated ? [
        "",
        `[Preview truncated at ${previewLimit} ${compactRead ? "characters" : "bytes"}; full normalized source remains at ${readablePath}.]`,
      ] : []),
    ].join("\n"),
    truncated: excerpt.truncated,
    visibleStart,
    visibleEnd,
  };
}
