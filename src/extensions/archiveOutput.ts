import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { SourceArchiveRecord } from "../tools/archive.js";

export function readableArchivePath(sessionId: string, sourcePath: string): string {
  return ["data", "sessions", sessionId, sourcePath].join("/");
}

export function archiveDetails(record: SourceArchiveRecord): Omit<SourceArchiveRecord, "content"> {
  const { content: _content, ...details } = record;
  return details;
}

export function archiveToolText(record: SourceArchiveRecord, readablePath = record.path): { text: string; truncated: boolean } {
  const excerpt = truncateHead(record.content, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const lineEnd = record.bodyLineOffset + excerpt.content.split("\n").length - 1;
  return {
    text: [
      `Evidence source_path: ${record.path}`,
      `Readable archive path: ${readablePath}`,
      `Archive offsets: 0-${record.bodyLineOffset + record.lines - 1} (${record.bodyLineOffset + record.lines} total lines).`,
      `Visible excerpt maps to source offsets ${record.bodyLineOffset}-${lineEnd} (zero-based).`,
      `For additional lines use read with path ${readablePath}; keep evidence_add source_path as ${record.path}.`,
      "",
      excerpt.content,
      ...(excerpt.truncated ? ["", `[Output truncated; full normalized source is readable at ${readablePath}]`] : []),
    ].join("\n"),
    truncated: excerpt.truncated,
  };
}
