import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GuidelineMcpClient, readGuideline, retrieveGuidelines, searchGuidelines, type GuidelineRetrieveItem, type GuidelineSearchItem } from "../tools/guidelineMcp.js";
import { archiveDetails } from "./archiveOutput.js";
import { piReadableSessionPath, piSessionDirectory } from "./sessionPath.js";

function renderSearchCards(title: string, items: GuidelineSearchItem[]): string {
  const lines = [title, ""];
  if (!items.length) return `${title}\n\nNo guideline records matched.`;
  items.slice(0, 5).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push("   document_card:");
    if (item.docId) lines.push(`     doc_id: ${item.docId}`);
    if (item.institution) lines.push(`     institution: ${item.institution}`);
    if (item.publicationDate) lines.push(`     date: ${item.publicationDate}`);
    if (item.documentKind) lines.push(`     kind: ${item.documentKind}`);
    if (item.departments?.length) lines.push(`     departments: ${item.departments.join(", ")}`);
    else if (item.department) lines.push(`     department: ${item.department}`);
    if (item.departmentScope) lines.push(`     department_scope: ${item.departmentScope}`);
    if (item.viewType || item.excerpt) lines.push("   matched_topic:");
    if (item.viewType) lines.push(`     type: ${item.viewType}`);
    if (item.excerpt) lines.push(`     excerpt: ${item.excerpt}`);
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

export function renderGuidelineReadText(readablePath: string, record: { content: string; bodyLineStart: number; lines: number; tocPath?: string }): string {
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
    `Readable guideline path: ${readablePath}`,
    ...(readableTocPath ? [`Readable source index: ${readableTocPath}`] : []),
    `Archive lines: 1-${totalLines} (${totalLines} total lines; 1-based).`,
    `For evidence_add, use this readable guideline path with exact offset/limit.`,
    ...(headings.length ? ["", "Useful section map:", ...headings] : []),
    "",
    `Informative preview lines ${previewStart}-${previewEnd}:`,
    "",
    compactLines(previewLines),
  ].join("\n");
}

function renderRetrieveCards(title: string, items: GuidelineRetrieveItem[], readablePath: (sourcePath: string) => string): string {
  const lines = [title, ""];
  if (!items.length) return `${title}\n\nNo guideline chunks matched.`;
  items.slice(0, 5).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    if (item.docId) lines.push(`   doc_id: ${item.docId}`);
    if (item.chunkId) lines.push(`   chunk_id: ${item.chunkId}`);
    if (item.institution) lines.push(`   institution: ${item.institution}`);
    if (item.publicationDate) lines.push(`   date: ${item.publicationDate}`);
    if (item.section) lines.push(`   section: ${item.section}`);
    if (item.chunkType) lines.push(`   chunk_type: ${item.chunkType}`);
    if (item.sourcePath) lines.push(`   readable chunk path: ${readablePath(item.sourcePath)}`);
    if (item.lineStart !== undefined && item.lineEnd !== undefined) lines.push(`   exact chunk lines: ${item.lineStart}-${item.lineEnd}`);
    if (item.score !== undefined) lines.push(`   retrieval score: ${item.score}`);
    if (item.excerpt) lines.push(`   excerpt: ${item.excerpt}`);
    lines.push("");
  });
  lines.push("These retrieved chunks are archived as citation-capable sources; use readable chunk path + exact chunk lines with evidence_add when the chunk directly supports a claim.");
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
        content: [{ type: "text", text: renderSearchCards("Guideline search candidates (top 5):", result.items) }],
        details: { archive: archiveDetails(result.archive), itemCount: result.items.length, truncated: false },
      };
    },
  });

  pi.registerTool({
    name: "guideline_mcp_retrieve",
    label: "Retrieve Guideline Chunks",
    description: "Run internal guideline RAG retrieval and archive each returned chunk as a citation-capable source with exact lines.",
    promptSnippet: "Retrieve traceable guideline chunks that can directly support evidence when relevant",
    promptGuidelines: ["RAG chunks may directly support evidence when the returned readable chunk path and exact lines match the claim; use guideline_mcp_read only when broader context is needed."],
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
        content: [{ type: "text", text: renderRetrieveCards("Guideline RAG retrieval candidates (top 5):", result.items, (sourcePath) => piReadableSessionPath(ctx.cwd, sessionId, sourcePath)) }],
        details: { archive: archiveDetails(result.archive), itemCount: result.items.length, chunkArchives: result.items.flatMap((item) => item.sourcePath ? [{ path: item.sourcePath, lineStart: item.lineStart, lineEnd: item.lineEnd }] : []), truncated: false },
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
      pi.events.emit("ebm:source_archived", { sessionId, provider: "guideline_mcp", path: result.archive.path, kind: "read" });
      return {
        content: [{ type: "text", text: renderGuidelineReadText(readablePath, result.archive) }],
        details: { archive: archiveDetails(result.archive), truncated: false },
      };
    },
  });
}
