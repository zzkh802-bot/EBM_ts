import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { SourceArchiveRecord } from "../tools/archive.js";

export function archiveDetails(record: SourceArchiveRecord): Omit<SourceArchiveRecord, "content"> {
  const { content: _content, ...details } = record;
  return details;
}

export function archiveToolText(record: SourceArchiveRecord): { text: string; truncated: boolean } {
  const excerpt = truncateHead(record.content, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const lineEnd = record.bodyLineOffset + excerpt.content.split("\n").length - 1;
  return {
    text: [
      `Archived source: ${record.path}`,
      `Visible excerpt maps to source offsets ${record.bodyLineOffset}-${lineEnd} (zero-based).`,
      "Use read on the archive for additional lines, then evidence_add with absolute source offsets.",
      "",
      excerpt.content,
      ...(excerpt.truncated ? ["", `[Output truncated; full normalized source is archived at ${record.path}]`] : []),
    ].join("\n"),
    truncated: excerpt.truncated,
  };
}
