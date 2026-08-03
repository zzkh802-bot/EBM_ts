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

function compactLines(lines: string[]): string {
  return lines.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function informativeHeading(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/^(?:guideline|document|preface)$/i.test(text.trim())) return false;
  if (/^[,\s]*(?:and\s+)?[a-z .'-]+\d*,?\s*$/i.test(text.trim()) && !/(abstract|methods|results|recommend|discussion|conclusion|table|pico|population)/i.test(text)) return false;
  return /(abstract|method|result|recommend|discussion|conclusion|pico|population|scope|treatment|therapy|diagnos|management|secondary prevention|acute)/i.test(normalized);
}

export function renderGuidelineReadText(
  readablePath: string,
  record: { content: string; bodyLineStart: number; lines: number; tocPath?: string; sourceId?: string; documentId?: string },
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
  const previewLines: string[] = [];
  for (const line of lines.slice(startIndex)) {
    if (previewLines.length && /^(?:#{1,6}\s+|Keywords\b|Date received\b|Correspondence\b|References\b)/i.test(line.trim())) break;
    if (!/^\s*\d+\s*$/.test(line)) previewLines.push(line);
    if (previewLines.length >= 12) break;
  }
  const previewStart = record.bodyLineStart + startIndex;
  const previewEnd = previewStart + previewLines.length - 1;
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
    ...(record.sourceId ? [`Source ID: ${record.sourceId}`] : []),
    ...(record.documentId ? [`Document ID: ${record.documentId}`] : []),
    ...(readableTocPath ? [`Readable source index: ${readableTocPath}`] : []),
    `Archive lines: 1-${totalLines} (${totalLines} total lines; 1-based).`,
    record.sourceId
      ? "For evidence_add, pass the Source ID above with a minimal, sufficient, continuous verbatim quote; use the readable path only for navigation."
      : "For evidence_add, use this readable guideline path and copy a minimal, sufficient, continuous verbatim quote.",
    ...(headings.length ? ["", "Best-effort navigation index (generated from cleaned Markdown; verify against full text):", ...headings] : []),
    "",
    `Informative preview lines ${previewStart}-${previewEnd}:`,
    "",
    compactLines(previewLines),
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
    if (item.sourceId) lines.push(`   source_id: ${item.sourceId}`);
    if (item.documentId) lines.push(`   document_id: ${item.documentId}`);
    const sourcePath = item.sourcePath ? readablePath(item.sourcePath) : undefined;
    if (sourcePath) lines.push(`   readable chunk path: ${sourcePath}`);
    if (item.quoteReadySpans?.length) {
      lines.push("   quote-ready continuous spans (pass source_span_id to evidence_add; do not copy or join text):", "");
      item.quoteReadySpans.forEach((span) => lines.push(`   source_span_id: ${span.id}`, indentedText(span.quote, 5), ""));
    } else if (item.candidateMaterial) {
      lines.push("   candidate material (identical to archived body):", "", item.candidateMaterial);
    }
    lines.push("");
  });
  lines.push("These are candidate materials, not evidence yet. Prefer evidence_add with one returned source_span_id. Use source_id plus a minimal, sufficient, continuous verbatim quote only when no single span is sufficient; never join separate spans or insert ellipses.");
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
    promptGuidelines: ["RAG chunks may directly support evidence. Prefer passing one returned source_span_id to evidence_add so exact archived text is selected without copying; never join separate spans or insert ellipses. Use guideline_mcp_read only when broader context is needed."],
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
        details: { archive: archiveDetails(result.archive), itemCount: result.items.length, chunkArchives: result.items.flatMap((item) => item.sourcePath ? [{ path: item.sourcePath, sourceId: item.sourceId, documentId: item.documentId, lineStart: item.lineStart, lineEnd: item.lineEnd, sourceSpanIds: item.quoteReadySpans?.map((span) => span.id) ?? [] }] : []), truncated: false },
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
