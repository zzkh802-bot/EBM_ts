import { writeFile } from "node:fs/promises";
import path from "node:path";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";
import { preprocessExternalContent } from "./markdown.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
};

export type GuidelineToolResult = { text: string; raw: unknown };
export type GuidelineMcpToolName = "search" | "read" | "retrieve";
export type GuidelineClient = { callTool(name: GuidelineMcpToolName, argumentsValue: Record<string, unknown>, signal?: AbortSignal): Promise<GuidelineToolResult> };

export type GuidelineSearchItem = {
  title: string;
  docId?: string;
  institution?: string;
  publicationDate?: string;
  department?: string;
  departments?: string[];
  documentKind?: string;
  viewId?: string;
  viewType?: string;
  abstract?: string;
  matchedViewContent?: string;
  availableViewTypes?: string[];
  fallbackMatch?: boolean;
};

export type GuidelineRetrieveItem = GuidelineSearchItem & {
  chunkId?: string;
  section?: string;
  chunkType?: string;
  rankingScore?: number;
  candidateMaterial?: string;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  documentId?: string;
  sourceId?: string;
  readId?: string;
};

export type GuidelineResult =
  | { ok: true; archive: SourceArchiveRecord; items: GuidelineSearchItem[] }
  | { ok: false; error: { code: "mcp_error"; message: string } };

export type GuidelineReadResult =
  | { ok: true; archive: SourceArchiveRecord; document: GuidelineSearchItem }
  | { ok: false; error: { code: "mcp_error"; message: string } };

export type GuidelineRetrieveResult =
  | { ok: true; archive: SourceArchiveRecord; items: GuidelineRetrieveItem[] }
  | { ok: false; error: { code: "mcp_error"; message: string } };

export class GuidelineMcpClient implements GuidelineClient {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private sessionId?: string;
  private protocolVersion = MCP_PROTOCOL_VERSION;
  private nextId = 1;
  private initialized: Promise<void> | undefined;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: { endpoint: string; fetcher?: typeof fetch; timeoutMs?: number }) {
    this.endpoint = options.endpoint;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  callTool(name: GuidelineMcpToolName, argumentsValue: Record<string, unknown>, signal?: AbortSignal): Promise<GuidelineToolResult> {
    const run = this.tail.then(() => this.callToolSerial(name, argumentsValue, signal));
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async callToolSerial(name: GuidelineMcpToolName, argumentsValue: Record<string, unknown>, signal?: AbortSignal): Promise<GuidelineToolResult> {
    this.initialized ??= this.initialize(signal).catch((error) => {
      this.initialized = undefined;
      throw error;
    });
    await this.initialized;
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: argumentsValue },
    }, true, signal);
    if (!response || !response.result || typeof response.result !== "object") throw new Error("MCP tools/call response has no result");
    const result = response.result as { content?: unknown; structuredContent?: unknown; isError?: unknown };
    const text = Array.isArray(result.content)
      ? result.content
        .filter((item): item is { type: string; text: string } => Boolean(item && typeof item === "object" && (item as any).type === "text" && typeof (item as any).text === "string"))
        .map((item) => item.text)
        .join("\n")
      : "";
    if (result.isError === true) throw new Error(`MCP ${name} failed: ${text || "unknown tool error"}`);
    // The current guideline MCP exposes the same payload twice: `structuredContent`
    // is the machine contract; `content[].text` is a presentation-compatible copy.
    // Prefer the former so document-level `result` arrays never depend on joining
    // several JSON strings. Keep text as a compatibility fallback for older servers.
    const structuredText = result.structuredContent === undefined ? "" : JSON.stringify(result.structuredContent);
    const effectiveText = structuredText || text;
    if (!effectiveText.trim()) throw new Error(`MCP ${name} returned no readable content`);
    return { text: effectiveText, raw: result };
  }

  private async initialize(signal?: AbortSignal): Promise<void> {
    const response = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "ebm-agent-ts", version: "0.1.0" },
      },
    }, false, signal);
    if (!response?.result || typeof response.result !== "object") throw new Error("MCP initialize response has no result");
    const negotiated = (response.result as { protocolVersion?: unknown }).protocolVersion;
    if (typeof negotiated !== "string" || !negotiated) throw new Error("MCP initialize response has no protocolVersion");
    this.protocolVersion = negotiated;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, true, signal);
  }

  private async post(payload: Record<string, unknown>, includeProtocol = true, signal?: AbortSignal): Promise<JsonRpcResponse | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`MCP request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(includeProtocol ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal: requestSignal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`MCP request timed out after ${this.timeoutMs}ms`, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) this.sessionId = newSessionId;
    if (!response.ok) {
      const body = (await response.text()).trim().slice(0, 500);
      throw new Error(`MCP HTTP ${response.status}: ${body || response.statusText}`);
    }
    if (response.status === 202 || response.status === 204) return undefined;
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: unknown;
    try {
      if (contentType.includes("text/event-stream")) {
        const data = body.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter((line) => line && line !== "[DONE]")
          .at(-1);
        if (!data) throw new Error("SSE response has no data event");
        parsed = JSON.parse(data);
      } else {
        parsed = JSON.parse(body);
      }
    } catch (error) {
      throw new Error(`MCP response contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== "object") throw new Error("MCP response is not a JSON object");
    const rpc = parsed as JsonRpcResponse;
    if (rpc.error) {
      throw new Error(`MCP JSON-RPC error ${String(rpc.error.code ?? "unknown")}: ${String(rpc.error.message ?? "unknown error")}`);
    }
    return rpc;
  }
}

function recordsFromParsedGuidelineSearch(parsed: unknown): Array<Record<string, unknown>> | undefined {
  if (Array.isArray(parsed)) return parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  for (const key of ["result", "results", "data", "items"]) {
    if (Array.isArray(record[key])) return recordsFromParsedGuidelineSearch(record[key]);
  }
  return [record];
}

function parseConcatenatedJsonObjects(text: string): Array<Record<string, unknown>> | undefined {
  const chunks: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (!depth && character !== "{") continue;
    if (!depth) current = "";
    if (inString && (character === "\n" || character === "\r")) {
      current += "\\n";
      continue;
    }
    current += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (!depth) chunks.push(current);
    }
  }
  if (!chunks.length || depth || inString) return undefined;
  try {
    return chunks.flatMap((chunk) => recordsFromParsedGuidelineSearch(JSON.parse(chunk)) ?? []);
  } catch {
    return undefined;
  }
}

function guidelineSearchItems(text: string): Array<Record<string, unknown>> | undefined {
  try {
    return recordsFromParsedGuidelineSearch(JSON.parse(text));
  } catch {
    return parseConcatenatedJsonObjects(text);
  }
}

export function cleanMcpExcerpt(value: string): string {
  return value
    .replace(/\[current\]\s*/gi, "")
    .replace(/\[(?:previous|next)\]\s*/gi, "")
    .replace(/©\s*[^.\n]{0,160}(?:rights reserved|all rights reserved)[^.\n]*\.?/gi, "")
    .replace(/Subject to Notice of rights\s*\([^)]*\)\.?/gi, "")
    .replace(/Notice of rights\s*\([^)]*\)\.?/gi, "")
    .replace(/https?:\/\/www\.nice\.org\.uk\/terms-and-[^\s)]+/gi, "")
    .replace(/sagepub\.com\/journals-permissions/gi, "")
    .replace(/journals\.sagepub\.com\/home\/\w+/gi, "")
    .replace(/Page\s+\d+\s+of\s+(?:conditions|\d+)\b[^.\n]*\.?/gi, "")
    .replace(/\b(?:doi|pmid|pmcid)\s*[:：]?\s*10\.\S+/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, (table) => table.replace(/<\/?(?:table|tbody|thead|tr)[^>]*>/gi, " ").replace(/<\/t[dh]>/gi, "; ").replace(/<t[dh][^>]*>/gi, ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#xa0;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();
}

function displayTitle(item: Record<string, unknown>, index: number): string {
  const candidate = String(item.title ?? item.name ?? "").replace(/\s+/g, " ").trim();
  if (candidate && !/^(?:guideline|open access|document)$/i.test(candidate)) return candidate;
  const institution = typeof item.source_institution === "string" ? item.source_institution.trim() : "";
  return `${institution || "Guideline"} result ${index + 1}`;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function viewText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return undefined;
}

function searchCardsFromText(text: string): GuidelineSearchItem[] {
  const items = guidelineSearchItems(text) ?? [];
  return items.map((item, index) => {
    const card: GuidelineSearchItem = { title: displayTitle(item, index) };
    if (typeof item.doc_id === "string" && item.doc_id.trim()) card.docId = item.doc_id.trim();
    if (typeof item.source_institution === "string" && item.source_institution.trim()) card.institution = item.source_institution.trim();
    if (typeof item.publication_date === "string" && item.publication_date.trim()) card.publicationDate = item.publication_date.trim();
    if (typeof item.clinical_department === "string" && item.clinical_department.trim()) card.department = item.clinical_department.trim();
    if (Array.isArray(item.clinical_departments)) {
      const departments = item.clinical_departments.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
      if (departments.length) card.departments = departments;
    }
    if (typeof item.document_kind === "string" && item.document_kind.trim()) card.documentKind = item.document_kind.trim();
    if (typeof item.view_id === "string" && item.view_id.trim()) card.viewId = item.view_id.trim();
    if (typeof item.view_type === "string" && item.view_type.trim()) card.viewType = item.view_type.trim();
    if (typeof item.abstract === "string" && item.abstract.trim()) card.abstract = preprocessExternalContent(item.abstract.trim());
    if (item.document_views && typeof item.document_views === "object" && !Array.isArray(item.document_views)) {
      const views = item.document_views as Record<string, unknown>;
      const viewTypes = Object.keys(views);
      if (viewTypes.length) card.availableViewTypes = viewTypes;
      if (card.viewType) {
        const matched = viewText(views[card.viewType]);
        if (matched) card.matchedViewContent = preprocessExternalContent(matched);
      }
    }
    if (item.is_fallback === true) card.fallbackMatch = true;
    return card;
  });
}

function retrievePriority(card: GuidelineRetrieveItem): number {
  let priority = card.rankingScore ?? 0;
  if (card.chunkType === "recommendation") priority += 0.01;
  if (/recommend/i.test(card.section ?? "")) priority += 0.005;
  if (/further research/i.test(card.section ?? "")) priority -= 0.02;
  return priority;
}

function retrieveCardsFromText(text: string): GuidelineRetrieveItem[] {
  const items = guidelineSearchItems(text) ?? [];
  const cards = items.map((item, index) => {
    const base = searchCardsFromText(JSON.stringify([item]))[0] ?? { title: displayTitle(item, index) };
    const card: GuidelineRetrieveItem = { ...base };
    if (typeof item.chunk_id === "string" && item.chunk_id.trim()) card.chunkId = item.chunk_id.trim();
    if (typeof item.chunk_type === "string" && item.chunk_type.trim()) card.chunkType = item.chunk_type.trim();
    const score = numberValue(item.score);
    if (score !== undefined) card.rankingScore = score;
    const section = Array.isArray(item.section_path)
      ? item.section_path.filter((entry) => typeof entry === "string" && entry.trim()).join(" > ")
      : typeof item.heading === "string" ? item.heading : undefined;
    if (section?.trim()) card.section = section.trim().slice(0, 240);
    // A retrieved record is candidate material, not validated evidence. `content`
    // is the complete returned material; source_quote_context is only a truncated
    // presentation preview in the current MCP and must not replace it.
    if (typeof item.content === "string" && item.content.trim()) card.candidateMaterial = item.content.trim();
    return card;
  }).sort((a, b) => retrievePriority(b) - retrievePriority(a));
  const counts = new Map<string, number>();
  return cards.filter((card) => {
    const key = card.docId ?? card.title;
    const count = counts.get(key) ?? 0;
    if (count >= 2) return false;
    counts.set(key, count + 1);
    return true;
  });
}

function renderGuidelineSearch(query: string, text: string): string {
  const items = guidelineSearchItems(text);
  if (!items) return `# Guideline search: ${query}\n\n${text.trim()}`;
  const lines = [`# Guideline search: ${query}`, "", `Status: ${items.length ? "completed" : "no_results"}`, `Results: ${items.length}`, ""];
  const cards = searchCardsFromText(text);
  if (cards.length) lines.push("## Result index", "", ...cards.map((card, index) => `- ${index + 1}. ${card.title} — document ID: ${card.docId ?? "not supplied"}`), "");
  cards.forEach((card, index) => {
    lines.push(`## ${index + 1}. ${card.title}`, "");
    if (card.docId) lines.push(`- Document ID: ${card.docId}`);
    if (card.institution) lines.push(`- Institution: ${card.institution}`);
    if (card.publicationDate) lines.push(`- Publication date: ${card.publicationDate}`);
    if (card.department) lines.push(`- Department: ${card.department}`);
    if (card.departments?.length) lines.push(`- Departments: ${card.departments.join(", ")}`);
    if (card.documentKind) lines.push(`- Document kind: ${card.documentKind}`);
    if (card.viewType) lines.push(`- Matched view type: ${card.viewType}`);
    if (card.viewId) lines.push(`- Matched view ID: ${card.viewId}`);
    if (card.fallbackMatch) lines.push("- Retrieval note: fallback match; verify relevance before reading.");
    if (card.abstract) lines.push("", "### Abstract", "", card.abstract);
    if (card.availableViewTypes?.length) lines.push(`- Available document views: ${card.availableViewTypes.join(", ")}`);
    if (card.matchedViewContent) lines.push("", "### Matched view content", "", card.matchedViewContent);
    lines.push("");
  });
  if (!cards.length) lines.push("No guideline records matched this query.", "");
  return lines.join("\n");
}

function informativeGuidelineHeading(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || /^(?:guideline|document|preface|references|orcid ids|acknowledgements)$/i.test(trimmed)) return false;
  if (/^European Stroke Journal/i.test(trimmed)) return false;
  if (/^Wardlaw et al\.?$/i.test(trimmed)) return false;
  if (/^[,\s]*(?:and\s+)?[A-Z][\p{L} .'-]+\d*[,*.\s]*$/u.test(trimmed) && !/(recommend|abstract|methods|results|discussion|pico|treatment|prevention|diagnos)/i.test(trimmed)) return false;
  return /(abstract|introduction|methods|results|discussion|conclusion|recommend|pico|treatment|therapy|diagnos|management|prevention|scope|population|future research)/i.test(trimmed);
}

async function rewriteGuidelineToc(sessionDir: string, archive: SourceArchiveRecord): Promise<void> {
  if (!archive.tocPath) return;
  const lines = archive.content.split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (!match) return [];
    const title = match[2]!.trim();
    return informativeGuidelineHeading(title) ? [{ level: match[1]!.length, title, index }] : [];
  });
  const output = [
    "# Guideline Source Index",
    "",
    `- Source: \`${archive.path}\``,
    `- Total lines: ${archive.bodyLineStart + archive.lines - 1}`,
    "- Line numbering: 1-based",
    "- Note: noisy PDF headings such as authors, affiliations, journal headers, and reference metadata are filtered.",
    "",
    "## Useful Sections",
    "",
  ];
  if (!headings.length) output.push("- No informative guideline headings detected.");
  headings.forEach((heading, position) => {
    let endIndex = lines.length - 1;
    for (const next of headings.slice(position + 1)) {
      if (next.level <= heading.level) {
        endIndex = next.index - 1;
        break;
      }
    }
    const start = archive.bodyLineStart + heading.index;
    const end = archive.bodyLineStart + endIndex;
    const preview = lines.slice(heading.index + 1, Math.min(endIndex + 1, heading.index + 8)).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
    output.push(`${"  ".repeat(Math.max(0, heading.level - 1))}- H${heading.level} ${heading.title} — lines ${start}-${Math.max(start, end)}`);
    if (preview) output.push(`${"  ".repeat(heading.level)}Preview: ${cleanMcpExcerpt(preview).slice(0, 200)}`);
  });
  await writeFile(path.join(sessionDir, archive.tocPath), `${output.join("\n")}\n`, "utf8");
}

function ragChunkArchiveName(card: GuidelineRetrieveItem): string {
  const sectionParts = card.section?.split(">").map((part) => part.trim()).filter(Boolean).slice(-2) ?? [];
  const sectionText = sectionParts.join(" ");
  return [card.title, sectionText, card.chunkType === "recommendation" ? "recommendation" : undefined]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");
}

function retrievedChunkWindow(record: SourceArchiveRecord): { lineStart: number; lineEnd: number } {
  const lines = record.content.split("\n");
  let first = 0;
  while (first < lines.length && !lines[first]!.trim()) first += 1;
  let last = lines.length - 1;
  while (last >= first && !lines[last]!.trim()) last -= 1;
  return { lineStart: record.bodyLineStart + first, lineEnd: record.bodyLineStart + Math.max(first, last) };
}

function renderGuidelineRetrieve(query: string, text: string): string {
  const cards = retrieveCardsFromText(text);
  const lines = [`# Guideline retrieve: ${query}`, "", `Status: ${cards.length ? "completed" : "no_results"}`, `Results: ${cards.length}`, ""];
  cards.forEach((card, index) => {
    lines.push(`## ${index + 1}. ${card.title}`, "");
    if (card.docId) lines.push(`- Document ID: ${card.docId}`);
    if (card.chunkId) lines.push(`- Chunk ID: ${card.chunkId}`);
    if (card.institution) lines.push(`- Institution: ${card.institution}`);
    if (card.publicationDate) lines.push(`- Publication date: ${card.publicationDate}`);
    if (card.section) lines.push(`- Section: ${card.section}`);
    if (card.chunkType) lines.push(`- Chunk type: ${card.chunkType}`);
    if (card.candidateMaterial) lines.push("", "### Candidate material", "", card.candidateMaterial);
    lines.push("");
  });
  if (!cards.length) lines.push("No guideline chunks matched this query.", "");
  return lines.join("\n");
}

export async function searchGuidelines(input: {
  sessionDir: string;
  query: string;
  client: GuidelineClient;
  topk?: number;
  sourceInstitution?: string;
  clinicalDepartment?: string;
  signal?: AbortSignal;
}): Promise<GuidelineResult> {
  try {
    const result = await input.client.callTool("search", {
      query: input.query,
      topk: Math.min(Math.max(input.topk ?? 5, 1), 20),
      ...(input.sourceInstitution ? { source_institution: input.sourceInstitution } : {}),
      ...(input.clinicalDepartment ? { clinical_department: input.clinicalDepartment } : {}),
    }, input.signal);
    const content = renderGuidelineSearch(input.query, result.text);
    return {
      ok: true,
      items: searchCardsFromText(result.text),
      archive: await archiveSource({ sessionDir: input.sessionDir, kind: "search", title: input.query, content }),
    };
  } catch (error) {
    return { ok: false, error: { code: "mcp_error", message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function retrieveGuidelines(input: {
  sessionDir: string;
  query: string;
  client: GuidelineClient;
  topk?: number;
  sourceInstitution?: string;
  clinicalDepartment?: string;
  signal?: AbortSignal;
}): Promise<GuidelineRetrieveResult> {
  try {
    const result = await input.client.callTool("retrieve", {
      query: input.query,
      topk: Math.min(Math.max(input.topk ?? 5, 1), 20),
      ...(input.sourceInstitution ? { source_institution: input.sourceInstitution } : {}),
      ...(input.clinicalDepartment ? { clinical_department: input.clinicalDepartment } : {}),
    }, input.signal);
    const items = retrieveCardsFromText(result.text);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const chunkArchive = await archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        layout: "file",
        ...(item.docId ? { sourceUrl: `mcp://guideline/${item.docId}${item.chunkId ? `#${encodeURIComponent(item.chunkId)}` : ""}` } : {}),
        title: item.title,
        archiveName: ragChunkArchiveName(item),
        ...(item.institution ? { sourceInstitution: item.institution } : {}),
        // Keep the citation source itself to the returned material. Provenance is
        // already carried by archive frontmatter (title + mcp:// doc/chunk URL),
        // so duplicating Markdown metadata would pollute the canonical quote source.
        content: item.candidateMaterial ?? "",
      });
      const window = retrievedChunkWindow(chunkArchive);
      item.sourcePath = chunkArchive.path;
      item.documentId = chunkArchive.documentId;
      item.sourceId = chunkArchive.sourceId;
      item.lineStart = window.lineStart;
      item.lineEnd = window.lineEnd;
      // The model must see the same normalized body that evidence_add will search.
      // archiveSource may decode entities and wrap long lines, so retaining the
      // pre-archive MCP string would make its visible text diverge from the archive.
      item.candidateMaterial = chunkArchive.content;
    }
    const content = renderGuidelineRetrieve(input.query, result.text);
    return {
      ok: true,
      items,
      archive: await archiveSource({ sessionDir: input.sessionDir, kind: "search", title: `${input.query} retrieve`, content }),
    };
  } catch (error) {
    return { ok: false, error: { code: "mcp_error", message: error instanceof Error ? error.message : String(error) } };
  }
}

function stripEmbeddedFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---\n", 4);
  return end >= 0 ? content.slice(end + 5).replace(/^\s+/, "") : content;
}

function meaningfulGuidelineTitle(content: string): string | undefined {
  const headings = content.split("\n").flatMap((line) => {
    const match = line.trim().match(/^#{1,3}\s+(.+)$/);
    return match ? [match[1]!.trim()] : [];
  }).filter((heading) => !/^(?:guideline|document|evidence)$/i.test(heading));
  if (!headings.length) return undefined;
  let title = headings[0]!;
  for (const continuation of headings.slice(1, 3)) {
    if (title.length >= 120 || /^[A-Z\p{Lu}\d]/u.test(continuation)) break;
    title = `${title} ${continuation}`;
  }
  return title.slice(0, 180).trim();
}

function isGenericGuidelineTitle(title?: string): boolean {
  return !title || /^(?:guideline|document|open access|full text)$/i.test(title.trim());
}

function extractGuidelineDocument(text: string): { content: string; title?: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const rawContent = typeof record.content === "string" ? record.content : undefined;
      const envelopeTitle = typeof record.title === "string" && record.title.trim() ? record.title.trim() : undefined;
      if (rawContent?.trim()) {
        const content = stripEmbeddedFrontmatter(rawContent);
        const title = isGenericGuidelineTitle(envelopeTitle) ? meaningfulGuidelineTitle(content) : envelopeTitle;
        return { content, ...(title ? { title } : {}) };
      }
    }
  } catch {
    // Plain Markdown is already the desired document representation.
  }
  const content = stripEmbeddedFrontmatter(text);
  const title = meaningfulGuidelineTitle(content);
  return { content, ...(title ? { title } : {}) };
}

export async function readGuideline(input: {
  sessionDir: string;
  client: GuidelineClient;
  docId?: string;
  title?: string;
  maxChars?: number;
  signal?: AbortSignal;
}): Promise<GuidelineReadResult> {
  if (!input.docId && !input.title) return { ok: false, error: { code: "mcp_error", message: "docId or title is required" } };
  try {
    const result = await input.client.callTool("read", {
      ...(input.docId ? { doc_id: input.docId } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.maxChars === undefined ? {} : { max_chars: input.maxChars }),
    }, input.signal);
    const document = extractGuidelineDocument(result.text);
    const metadata = searchCardsFromText(result.text)[0] ?? { title: document.title ?? input.title ?? input.docId ?? "guideline" };
    const archive = await archiveSource({
      sessionDir: input.sessionDir,
      kind: "read",
      ...(input.docId ? { sourceUrl: `mcp://guideline/${input.docId}` } : {}),
      ...(metadata.institution ? { sourceInstitution: metadata.institution } : {}),
      title: document.title ?? input.title ?? input.docId ?? "guideline",
      content: document.content,
    });
    await rewriteGuidelineToc(input.sessionDir, archive);
    return { ok: true, archive, document: metadata };
  } catch (error) {
    return { ok: false, error: { code: "mcp_error", message: error instanceof Error ? error.message : String(error) } };
  }
}
