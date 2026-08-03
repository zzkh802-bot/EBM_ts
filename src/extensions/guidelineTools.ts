import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GuidelineMcpClient, readGuideline, retrieveGuidelines, searchGuidelines, type GuidelineRetrieveItem, type GuidelineSearchItem } from "../tools/guidelineMcp.js";
import { upsertSourceLibraryFromArchive } from "../tools/sourceLibrary.js";
import { archiveDetails } from "./archiveOutput.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function indentedText(value: string, spaces = 4): string {
  return value.split("\n").map((line) => `${" ".repeat(spaces)}${line}`).join("\n");
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderSearchCards(title: string, items: GuidelineSearchItem[]): string {
  const lines = [title, ""];
  if (!items.length) return `${title}\n\nNo guideline records matched.`;
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    if (item.docId) lines.push(`   doc_id: ${item.docId}`);
    if (item.institution) lines.push(`   catalog source: ${item.institution}`);
    if (item.publicationDate) lines.push(`   publication date: ${item.publicationDate}`);
    if (item.documentKind) lines.push(`   document kind: ${item.documentKind}`);
    if (item.departments?.length) lines.push(`   indexed departments: ${item.departments.join(", ")}`);
    else if (item.department) lines.push(`   indexed department: ${item.department}`);
    if (item.fallbackMatch) lines.push("   retrieval note: fallback match; verify relevance before reading.");
    if (item.viewId || item.viewType) lines.push(`   matched view: ${[item.viewType, item.viewId].filter(Boolean).join(" · ")}`);
    if (item.availableViewTypes?.length) lines.push(`   available document views: ${item.availableViewTypes.join(", ")}`);
    if (item.matchedViewContent) lines.push("   matched view content:", indentedText(item.matchedViewContent, 5));
    if (item.abstract && normalizedText(item.abstract) !== normalizedText(item.matchedViewContent ?? "")) lines.push("   abstract:", indentedText(item.abstract, 5));
    lines.push("");
  });
  return lines.join("\n");
}

function numberLines(lines: Array<{ line: number; text: string }>): string {
  return lines.map((line) => `${String(line.line).padStart(5, " ")}│${line.text}`).join("\n");
}

function informativeHeading(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/^(?:guideline|document|preface)$/i.test(text.trim())) return false;
  if (/^[,\s]*(?:and\s+)?[a-z .'-]+\d*,?\s*$/i.test(text.trim()) && !/(abstract|methods|results|recommend|discussion|conclusion|table|pico|population)/i.test(text)) return false;
  return /(abstract|method|result|recommend|discussion|conclusion|pico|population|scope|treatment|therapy|diagnos|management|secondary prevention|acute)/i.test(normalized);
}

export function renderGuidelineReadText(
  readablePath: string,
  record: { content: string; bodyLineStart: number; lines: number; tocPath?: string },
  document?: GuidelineSearchItem,
): string {
  const lines = record.content.split("\n");
  const totalLines = record.bodyLineStart + record.lines - 1;
  const headings = lines.flatMap((line, index) => {
    const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (!match) return [];
    const title = match[2]!.trim();
    return informativeHeading(title) ? [`- ${match[1]} ${title} — line ${record.bodyLineStart + index}`] : [];
  }).slice(0, 20);
  const targetIndex = [
    /\b(?:evidence[- ]based recommendation|recommend(?:ation|ed)?)\b/i,
    /\bconclusion\b/i,
    /\babstract\b/i,
  ].map((pattern) => lines.findIndex((line) => pattern.test(line))).find((index) => index >= 0) ?? -1;
  const startIndex = Math.max(0, targetIndex >= 0 ? targetIndex : 0);
  const previewLines: Array<{ line: number; text: string }> = [];
  for (const [offset, line] of lines.slice(startIndex).entries()) {
    if (previewLines.length && /^(?:#{1,6}\s+|Keywords\b|Date received\b|Correspondence\b|References\b)/i.test(line.trim())) break;
    if (!/^\s*\d+\s*$/.test(line)) previewLines.push({ line: record.bodyLineStart + startIndex + offset, text: line });
    if (previewLines.length >= 12) break;
  }
  const previewStart = previewLines[0]?.line ?? record.bodyLineStart + startIndex;
  const previewEnd = previewLines.at(-1)?.line ?? previewStart;
  const readableTocPath = record.tocPath ? readablePath.replace(/full\.md$/, "toc.md") : undefined;
  return [
    ...(document ? [
      "Source document:",
      `- Title: ${document.title}`,
      ...(document.institution ? [`- Catalog source: ${document.institution}`] : []),
      ...(document.publicationDate ? [`- Publication date: ${document.publicationDate}`] : []),
      ...(document.documentKind ? [`- Document kind: ${document.documentKind}`] : []),
      "",
    ] : []),
    `Readable guideline path: ${readablePath}`,
    ...(readableTocPath ? [`Readable source index: ${readableTocPath}`] : []),
    `Archive lines: 1-${totalLines} (${totalLines} total lines; 1-based).`,
    "After read, choose one evidence_add locator: the returned read_id with start_text/end_text (source_path optional), or source_path with line_start/line_end (text anchors optional). Layout/XML/entity/punctuation noise is normalized; clinical numbers and wording are not repaired.",
    ...(headings.length ? ["", "Best-effort navigation index (generated from cleaned Markdown; verify against full text):", ...headings] : []),
    "",
    `Informative preview lines ${previewStart}-${previewEnd}:`,
    "",
    numberLines(previewLines),
  ].join("\n");
}

export function renderRetrieveCards(title: string, items: GuidelineRetrieveItem[], readablePath: (sourcePath: string) => string): string {
  const lines = [title, ""];
  if (!items.length) return `${title}\n\nNo guideline chunks matched.`;
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    if (item.docId) lines.push(`   doc_id: ${item.docId}`);
    if (item.chunkId) lines.push(`   chunk_id: ${item.chunkId}`);
    if (item.institution) lines.push(`   catalog source: ${item.institution}`);
    if (item.publicationDate) lines.push(`   date: ${item.publicationDate}`);
    if (item.section) lines.push(`   section: ${item.section}`);
    if (item.chunkType) lines.push(`   chunk_type: ${item.chunkType}`);
    const sourcePath = item.sourcePath ? readablePath(item.sourcePath) : undefined;
    if (sourcePath) lines.push(`   readable chunk path: ${sourcePath}`);
    if (item.candidateMaterial) {
      lines.push("   candidate material (identical to archived body):", "", item.candidateMaterial);
    }
    lines.push("");
  });
  lines.push("These are candidate materials, not evidence yet. Read the relevant source path, then choose read_id plus start_text/end_text (source_path optional), or source_path plus line_start/line_end. Layout/XML/entity/punctuation noise is normalized; if candidates are returned after a mismatch, copy them and retry instead of scanning with bash.");
  return lines.join("\n");
}

export function registerGuidelineTools(pi: Pick<ExtensionAPI, "registerTool" | "events">): void {
  const endpoint = process.env.GUIDELINE_MCP_URL?.trim();
  if (!endpoint) return;
  const timeout = Number(process.env.GUIDELINE_MCP_TIMEOUT_MS ?? 45_000);
  const client = new GuidelineMcpClient({
    endpoint,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 45_000,
  });

  pi.registerTool({
    name: "guideline_mcp_search",
    label: "Search Guideline Library",
    description: "Search the internal guideline MCP sequentially and archive the returned document-level results.",
    promptSnippet: "Search the internal guideline index for document IDs",
    promptGuidelines: ["Search first, then use guideline_mcp_read on the best doc_id before creating evidence."],
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "Prefer a short high-information English query" }),
      topk: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      source_institution: Type.Optional(Type.String()),
      clinical_department: Type.Optional(Type.String({ description: "Chinese department name expected by the internal index" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Searching internal guideline library…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await searchGuidelines({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        client,
        ...(params.topk === undefined ? {} : { topk: params.topk }),
        ...(params.source_institution ? { sourceInstitution: params.source_institution } : {}),
        ...(params.clinical_department ? { clinicalDepartment: params.clinical_department } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: result.archive.path, kind: "search" });
      return {
        content: [{ type: "text", text: renderSearchCards(`Guideline search candidates (${result.items.length} returned):`, result.items) }],
        details: { archive: archiveDetails(result.archive), itemCount: result.items.length, truncated: false },
      };
    },
  });

  pi.registerTool({
    name: "guideline_mcp_retrieve",
    label: "Retrieve Guideline Chunks",
    description: "Run internal guideline RAG retrieval and archive each returned chunk as a citation-capable quote source.",
    promptSnippet: "Retrieve traceable guideline chunks that can directly support evidence when relevant",
    promptGuidelines: ["RAG chunks may directly support evidence. Read the returned source path, then use read_id plus exact start_text/end_text with evidence_add; if read_id is unavailable, use the returned line range. Never join separate spans or insert ellipses. Use guideline_mcp_read when broader context is needed."],
    parameters: Type.Object({
      query: Type.String({ minLength: 2, description: "Focused clinical retrieval query" }),
      topk: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      source_institution: Type.Optional(Type.String()),
      clinical_department: Type.Optional(Type.String({ description: "Chinese department name expected by the internal index" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Retrieving guideline chunks…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await retrieveGuidelines({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        query: params.query,
        client,
        ...(params.topk === undefined ? {} : { topk: params.topk }),
        ...(params.source_institution ? { sourceInstitution: params.source_institution } : {}),
        ...(params.clinical_department ? { clinicalDepartment: params.clinical_department } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: result.archive.path, kind: "search" });
      result.items.forEach((item) => {
        if (item.sourcePath) pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: item.sourcePath, kind: "read", sourceStatus: "rag_chunk" });
      });
      return {
        content: [{ type: "text", text: renderRetrieveCards(`Guideline RAG retrieval candidates (${result.items.length} returned):`, result.items, (sourcePath) => piReadableSessionPath(ctx.cwd, sessionId, sourcePath)) }],
        details: { archive: archiveDetails(result.archive), itemCount: result.items.length, chunkArchives: result.items.flatMap((item) => item.sourcePath ? [{ path: item.sourcePath, sourceId: item.sourceId, documentId: item.documentId, lineStart: item.lineStart, lineEnd: item.lineEnd }] : []), truncated: false },
      };
    },
  });

  pi.registerTool({
    name: "guideline_mcp_read",
    label: "Read Guideline",
    description: "Read one full guideline from the internal MCP by doc_id or exact title and archive it before exposure.",
    promptSnippet: "Read and archive a guideline selected from internal search",
    parameters: Type.Object({
      doc_id: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Reading and archiving guideline…" }], details: {} });
      const sessionId = ctx.sessionManager.getSessionId();
      const result = await readGuideline({
        sessionDir: piSessionDirectory(ctx.cwd, sessionId),
        client,
        ...(params.doc_id ? { docId: params.doc_id } : {}),
        ...(params.title ? { title: params.title } : {}),
        maxChars: 500_000,
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const readablePath = piReadableSessionPath(ctx.cwd, sessionId, result.archive.path);
      const sourceLibraryDir = process.env.SOURCE_LIBRARY_DIR || "data/source_library/guidelines";
      const library = await upsertSourceLibraryFromArchive({ sourceLibraryDir, archive: result.archive, provider: "guideline_mcp", sessionId });
      pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: result.archive.path, kind: "read", sourceLibraryPath: library.path, sourceLibraryWritten: library.written });
      return {
        content: [{ type: "text", text: renderGuidelineReadText(readablePath, result.archive, result.document) }],
        details: { archive: archiveDetails(result.archive), sourceLibrary: library, truncated: false },
      };
    },
  });
}
