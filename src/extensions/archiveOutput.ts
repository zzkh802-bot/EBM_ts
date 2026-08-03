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

function sourceMap(content: string, bodyLineStart: number): { items: string[]; total: number } {
  const headings = content.split("\n").flatMap((line, index) => {
    const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
    return match ? [{ line: `- ${match[1]} ${match[2]} — line ${bodyLineStart + index}` }] : [];
  });
  return { items: headings.slice(0, MAP_MAX_ITEMS).map((item) => item.line), total: headings.length };
}

export function archiveToolText(
  record: SourceArchiveRecord,
  readablePath = record.path,
  options: { compactRead?: boolean; citationEligible?: boolean } = {},
): { text: string; truncated: boolean } {
  const previewBytes = options.compactRead ? READ_PREVIEW_BYTES : DEFAULT_MAX_BYTES;
  const excerpt = truncateHead(record.content, {
    maxBytes: previewBytes,
    maxLines: DEFAULT_MAX_LINES,
  });
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
      `Document ID: ${record.documentId}`,
      ...(readableTocPath ? [`Readable source index: ${readableTocPath}`] : []),
      ...(readableResources.length ? [`Archived referenced resources: ${readableResources.join(", ")}`] : []),
      `Archive lines: 1-${totalLines} (${totalLines} total lines; 1-based).`,
      `Visible preview maps to lines ${visibleStart}-${visibleEnd}.`,
      `Read any archive window with read(path=${JSON.stringify(readablePath)}, offset=N, limit=M).`,
      ...(options.citationEligible === false
        ? ["This search snapshot is discovery history and cannot be passed to evidence_add; use an individually archived sources/read document."]
        : ["For evidence_add, pass the Source ID above with a minimal, sufficient, continuous verbatim quote from the source; use the readable path only for navigation."]),
      ...(excerpt.truncated ? [`Continue without gaps (the last preview line is intentionally repeated): read(path=${JSON.stringify(readablePath)}, offset=${Math.max(record.bodyLineStart, visibleEnd)}, limit=200).`] : []),
      ...(readableTocPath ? [`Read the complete section index with read(path=${JSON.stringify(readableTocPath)}).`] : []),
      ...(map.items.length ? ["", `Source map${map.total > map.items.length ? ` (first ${map.items.length} of ${map.total}; complete index is in toc.md)` : ""}:`, ...map.items] : []),
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
