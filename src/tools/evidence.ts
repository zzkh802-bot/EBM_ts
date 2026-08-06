import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { locateEvidenceAnchors, locateEvidenceQuote, locateEvidenceRange, type EvidenceMatchMode } from "./evidenceLocator.js";
import { resolveReadReceipt, type ReadReceipt } from "./readRegistry.js";
import { resolveSourceId, sourceIdentityForPath } from "./sourceIdentity.js";
import { formatBeijingTimestamp } from "./time.js";

export type EvidenceRelation = "supports" | "partially_supports" | "refutes";
export type EvidenceConfidence = "low" | "moderate" | "high";
export type EvidenceProvenance =
  | "primary_full_text"
  | "primary_abstract"
  | "guideline_official"
  | "guideline_mirror_verified"
  | "guideline_mirror_unverified"
  | "secondary_direct_quote"
  | "secondary_paraphrase"
  | "independent_guideline"
  | "expert_consensus"
  | "discovery_only"
  | "other";

export type EvidenceNode = {
  id: string;
  question: string;
  claim: string;
  relation: EvidenceRelation;
  provenance: EvidenceProvenance;
  confidence: EvidenceConfidence;
  sourcePath: string;
  sourceId?: string;
  documentId?: string;
  quote: string;
  lineStart: number;
  lineEnd: number;
  charStart?: number;
  charEnd?: number;
  matchMode?: EvidenceMatchMode;
  contentHash: string;
  createdAt: string;
  citationEligible: boolean;
};

export type EvidenceAddInput = {
  sessionDir: string;
  question: string;
  claim: string;
  relation: EvidenceRelation;
  provenance?: EvidenceProvenance;
  confidence?: EvidenceConfidence;
  sourcePath?: string;
  sourceId?: string;
  quote: string;
};

export type EvidenceAnchorAddInput = Omit<EvidenceAddInput, "sourcePath" | "sourceId" | "quote"> & {
  sourcePath?: string;
  readId?: string;
  lineStart?: number;
  lineEnd?: number;
  startText?: string;
  endText?: string;
};

function assertRelativeSafe(rel: string): void {
  if (!rel || rel.startsWith("/") || rel.includes("\0") || rel.split(/[\\/]+/).includes("..")) {
    throw new Error(`unsafe relative path: ${rel}`);
  }
}

async function resolveExistingSessionPath(sessionDir: string, rel: string): Promise<string> {
  assertRelativeSafe(rel);
  const [root, target] = await Promise.all([
    realpath(sessionDir),
    realpath(path.join(sessionDir, rel)),
  ]);
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`source path resolves outside session directory: ${rel}`);
  }
  return target;
}

function evidenceId(input: Omit<EvidenceNode, "id" | "createdAt" | "citationEligible">): string {
  const { matchMode: _matchMode, ...stableIdentity } = input;
  return `ev_${createHash("sha256").update(JSON.stringify(stableIdentity)).digest("hex").slice(0, 16)}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function quoteFence(quote: string): string {
  const longest = Math.max(0, ...Array.from(quote.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function renderEvidenceMarkdown(node: EvidenceNode): string {
  const fence = quoteFence(node.quote);
  return [
    "---",
    `evidence_id: ${node.id}`,
    `question: ${yamlString(node.question)}`,
    `claim: ${yamlString(node.claim)}`,
    `relation: ${node.relation}`,
    `provenance: ${node.provenance}`,
    `confidence: ${node.confidence}`,
    `source_path: ${yamlString(node.sourcePath)}`,
    ...(node.sourceId ? [`source_id: ${node.sourceId}`] : []),
    ...(node.documentId ? [`document_id: ${node.documentId}`] : []),
    `source_line_start: ${node.lineStart}`,
    `source_line_end: ${node.lineEnd}`,
    ...(node.charStart === undefined ? [] : [`source_char_start: ${node.charStart}`]),
    ...(node.charEnd === undefined ? [] : [`source_char_end: ${node.charEnd}`]),
    ...(node.matchMode === undefined ? [] : [`source_match_mode: ${node.matchMode}`]),
    `content_hash: ${node.contentHash}`,
    `created_at: ${yamlString(node.createdAt)}`,
    `interpretation_status: active`,
    `citation_eligible: ${node.citationEligible}`,
    "---",
    "",
    `# Evidence: ${node.claim}`,
    "",
    "## Claim Relation",
    "",
    `${node.relation}: ${node.claim}`,
    "",
    "## Exact Quote",
    "",
    `${fence}text`,
    node.quote,
    fence,
    "",
  ].join("\n");
}

async function updateEvidenceIndex(outDir: string, node: EvidenceNode): Promise<void> {
  const indexPath = path.join(outDir, "EVIDENCE.md");
  let current = "# Evidence Index\n\nEvidence records contain exact archived source quotes. Read a record before citing it.\n\n";
  try {
    current = await readFile(indexPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (current.includes(`[${node.id}](`)) return;
  const entry = `- [${node.id}](${node.id}.md) — **${node.relation}** — ${node.claim}\n`;
  await writeFile(indexPath, `${current}${current.endsWith("\n") ? "" : "\n"}${entry}`, "utf8");
}

/**
 * Legacy programmatic quote API retained for report/import callers. The Pi
 * model-facing evidence_add tool uses addEvidenceFromAnchors instead, so this
 * fuzzy recovery path is not part of the normal research trajectory.
 */
export async function addEvidence(input: EvidenceAddInput): Promise<EvidenceNode> {
  if (Boolean(input.sourcePath) === Boolean(input.sourceId)) throw new Error("provide exactly one of sourcePath or sourceId");
  const sourcePath = input.sourceId ? (await resolveSourceId(input.sessionDir, input.sourceId)).path : input.sourcePath!;
  assertRelativeSafe(sourcePath);
  const normalizedSourcePath = path.posix.normalize(sourcePath.replaceAll("\\", "/"));
  if (normalizedSourcePath.startsWith("sources/search/")) {
    throw new Error("search snapshots are discovery artifacts; create evidence from an individually archived sources/read document");
  }
  if (!input.question.trim()) throw new Error("question is required");
  if (!input.claim.trim()) throw new Error("claim is required");
  if (!input.quote.trim()) throw new Error("quote is required");

  const sourceAbs = await resolveExistingSessionPath(input.sessionDir, sourcePath);
  const text = await readFile(sourceAbs, "utf8");
  const located = locateEvidenceQuote(text, input.quote);
  return persistLocatedEvidence(input, sourcePath, located);
}

export async function addEvidenceFromAnchors(input: EvidenceAnchorAddInput): Promise<EvidenceNode> {
  if (Boolean(input.lineStart) !== Boolean(input.lineEnd)) throw new Error("line_start and line_end must be provided together");
  let lineStart = input.lineStart;
  let lineEnd = input.lineEnd;
  let readIdMode = false;
  let normalizedSourcePath: string;
  let receipt: ReadReceipt | undefined;
  if (input.readId) {
    readIdMode = true;
    receipt = await resolveReadReceipt(input.sessionDir, input.readId);
    normalizedSourcePath = normalizeEvidenceSourcePath(input.sourcePath ?? receipt.sourcePath);
    if (receipt.sourcePath !== normalizedSourcePath) throw new Error("read_id does not match source_path");
    // Line numbers are an optional narrowing hint. Models may copy a stale
    // candidate range or a range from a different read, so do not reject the
    // authoritative read_id solely because the hint falls outside it. The
    // anchor match below remains bounded by the receipt either way.
    if (lineStart !== undefined) {
      lineStart = Math.max(receipt.lineStart, lineStart);
      lineEnd = Math.min(receipt.lineEnd, lineEnd!);
      if (lineStart > lineEnd) {
        lineStart = receipt.lineStart;
        lineEnd = receipt.lineEnd;
      }
    } else {
      lineStart = receipt.lineStart;
      lineEnd = receipt.lineEnd;
    }
  } else {
    if (!input.sourcePath?.trim()) throw new Error("source_path is required when read_id is absent");
    normalizedSourcePath = normalizeEvidenceSourcePath(input.sourcePath);
    if (lineStart === undefined || lineEnd === undefined) {
      throw new Error("provide read_id or source_path with line_start and line_end");
    }
  }
  const sourceAbs = await resolveExistingSessionPath(input.sessionDir, normalizedSourcePath);
  const source = await readFile(sourceAbs, "utf8");
  if (receipt) {
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (sourceHash !== receipt.sourceHash) throw new Error("read_id no longer matches the archived source revision");
  }
  const hasStart = Boolean(input.startText?.trim());
  const hasEnd = Boolean(input.endText?.trim());
  if (hasStart !== hasEnd) {
    throw new Error("start_text and end_text must be provided together");
  }
  if (readIdMode && (!hasStart || !hasEnd)) {
    throw new Error("read_id requires both start_text and end_text; when text anchors are unavailable, omit read_id and use source_path with line_start and line_end");
  }
  let located: ReturnType<typeof locateEvidenceRange>;
  if (hasStart && hasEnd) {
    try {
      located = await locateAnchorsOrRange(source, input.startText!, input.endText!, lineStart!, lineEnd!, readIdMode);
    } catch (error) {
      const receiptRange = receipt ? { lineStart: receipt.lineStart, lineEnd: receipt.lineEnd } : undefined;
      const usedNarrowRange = receiptRange && (lineStart !== receiptRange.lineStart || lineEnd !== receiptRange.lineEnd);
      if (!readIdMode || !usedNarrowRange) throw error;
      try {
        // A stale line hint must not invalidate anchors that are unique within
        // the same receipt. This is still bounded and never becomes a whole
        // source fallback because read_id anchors remain mandatory.
        located = locateEvidenceAnchors(source, input.startText!, input.endText!, receiptRange);
      } catch {
        throw error;
      }
    }
  } else {
    located = locateEvidenceRange(source, lineStart!, lineEnd!, "line_range");
  }
  return persistLocatedEvidence({
    sessionDir: input.sessionDir,
    question: input.question,
    claim: input.claim,
    relation: input.relation,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.confidence ? { confidence: input.confidence } : {}),
  }, normalizedSourcePath, located);
}

function normalizeEvidenceSourcePath(value: string): string {
  const sourcePath = value.replaceAll("\\", "/");
  assertRelativeSafe(sourcePath);
  const normalized = path.posix.normalize(sourcePath);
  if (normalized.startsWith("data/sessions/")) throw new Error("source_path must be relative to the current session workspace");
  if (normalized.startsWith("sources/search/")) {
    throw new Error("search snapshots are discovery artifacts; create evidence from an individually archived sources/read document");
  }
  return normalized;
}

async function locateAnchorsOrRange(
  source: string,
  startText: string,
  endText: string,
  lineStart: number,
  lineEnd: number,
  readIdMode: boolean,
): Promise<ReturnType<typeof locateEvidenceAnchors>> {
  try {
    return locateEvidenceAnchors(source, startText, endText, { lineStart, lineEnd });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (readIdMode) {
      throw new Error(`${error.message} 请保留当前 read_id，改用同一片段中更独特的 start_text/end_text；如果片段过大，请先重新读取更窄的窗口。不会自动把整个 read_id 范围保存为证据。`);
    }
    // Anchor text is a precision aid, not a reason to lose an otherwise
    // version-checked read/line record. Keep the bounded quote and expose its
    // broad locator mode in evidence metadata when matching is unsuccessful.
    return locateEvidenceRange(source, lineStart, lineEnd, readIdMode ? "read_id_range" : "line_range");
  }
}

async function persistLocatedEvidence(
  input: Omit<EvidenceAddInput, "sourcePath" | "sourceId" | "quote">,
  sourcePath: string,
  located: ReturnType<typeof locateEvidenceQuote>,
): Promise<EvidenceNode> {
  const quote = located.quote;
  const identity = await sourceIdentityForPath(input.sessionDir, sourcePath);
  const provenance = input.provenance ?? "other";
  const contentHash = createHash("sha256").update(quote).digest("hex");
  const base = {
    question: input.question.trim(),
    claim: input.claim.trim(),
    relation: input.relation,
    provenance,
    confidence: input.confidence ?? "moderate",
    sourcePath,
    sourceId: identity.sourceId,
    documentId: identity.documentId,
    quote,
    lineStart: located.lineStart,
    lineEnd: located.lineEnd,
    charStart: located.charStart,
    charEnd: located.charEnd,
    matchMode: located.matchMode,
    contentHash,
  };
  const node: EvidenceNode = {
    id: evidenceId(base),
    ...base,
    createdAt: formatBeijingTimestamp(),
    citationEligible: base.provenance !== "discovery_only",
  };
  const outDir = path.join(input.sessionDir, "evidence");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${node.id}.md`), renderEvidenceMarkdown(node), "utf8");
  await updateEvidenceIndex(outDir, node);
  return node;
}

function parseScalar(value: string): string | number | boolean {
  if (value.startsWith('"')) return JSON.parse(value) as string;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function parseEvidenceMarkdown(markdown: string): EvidenceNode {
  if (!markdown.startsWith("---\n")) throw new Error("evidence frontmatter is missing");
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("evidence frontmatter is unterminated");
  const metadata = new Map<string, string | number | boolean>();
  for (const line of markdown.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`invalid evidence metadata line: ${line}`);
    metadata.set(line.slice(0, separator), parseScalar(line.slice(separator + 1).trim()));
  }
  const quoteHeading = "\n## Exact Quote\n\n";
  const quoteStart = markdown.indexOf(quoteHeading, end);
  if (quoteStart < 0) throw new Error("evidence exact quote is missing");
  const fenced = markdown.slice(quoteStart + quoteHeading.length);
  const firstBreak = fenced.indexOf("\n");
  if (firstBreak < 0) throw new Error("evidence quote fence is malformed");
  const opening = fenced.slice(0, firstBreak);
  const fence = opening.replace(/text$/, "");
  if (!/^`{3,}$/.test(fence)) throw new Error("evidence quote fence is malformed");
  const closing = `\n${fence}`;
  const quoteEnd = fenced.indexOf(closing, firstBreak + 1);
  if (quoteEnd < 0) throw new Error("evidence quote fence is unterminated");

  const requiredString = (key: string): string => {
    const value = metadata.get(key);
    if (typeof value !== "string" || !value) throw new Error(`evidence metadata ${key} is required`);
    return value;
  };
  const requiredNumber = (key: string): number => {
    const value = metadata.get(key);
    if (typeof value !== "number") throw new Error(`evidence metadata ${key} must be a number`);
    return value;
  };
  const optionalString = (key: string): string | undefined => {
    const value = metadata.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) throw new Error(`evidence metadata ${key} must be a string`);
    return value;
  };
  const optionalNumber = (key: string): number | undefined => {
    const value = metadata.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== "number") throw new Error(`evidence metadata ${key} must be a number`);
    return value;
  };
  const relation = requiredString("relation");
  if (!(["supports", "partially_supports", "refutes"] as string[]).includes(relation)) {
    throw new Error(`invalid evidence relation: ${relation}`);
  }
  const provenance = (metadata.get("provenance") ?? "other") as string;
  const allowedProvenance: EvidenceProvenance[] = [
    "primary_full_text", "primary_abstract", "guideline_official", "guideline_mirror_verified",
    "guideline_mirror_unverified", "secondary_direct_quote", "secondary_paraphrase",
    "independent_guideline", "expert_consensus", "discovery_only", "other",
  ];
  if (!allowedProvenance.includes(provenance as EvidenceProvenance)) throw new Error(`invalid evidence provenance: ${provenance}`);
  const rawConfidence = (metadata.get("confidence") ?? "moderate") as string;
  const confidence = ({ "低": "low", "中": "moderate", "高": "high" } as Record<string, string>)[rawConfidence] ?? rawConfidence;
  if (!(["low", "moderate", "high"] as string[]).includes(confidence)) throw new Error(`invalid evidence confidence: ${confidence}`);
  const matchMode = metadata.get("source_match_mode");
  if (matchMode !== undefined && !["exact", "layout_normalized", "noise_normalized", "read_id_range", "line_range"].includes(String(matchMode))) {
    throw new Error(`invalid evidence source_match_mode: ${String(matchMode)}`);
  }
  const charStart = optionalNumber("source_char_start");
  const charEnd = optionalNumber("source_char_end");
  const sourceId = optionalString("source_id");
  const documentId = optionalString("document_id");
  if ((charStart === undefined) !== (charEnd === undefined)) throw new Error("evidence character coordinates must be stored together");
  return {
    id: requiredString("evidence_id"),
    question: requiredString("question"),
    claim: requiredString("claim"),
    relation: relation as EvidenceRelation,
    provenance: provenance as EvidenceProvenance,
    confidence: confidence as EvidenceConfidence,
    sourcePath: requiredString("source_path"),
    ...(sourceId ? { sourceId } : {}),
    ...(documentId ? { documentId } : {}),
    quote: fenced.slice(firstBreak + 1, quoteEnd),
    lineStart: requiredNumber("source_line_start"),
    lineEnd: requiredNumber("source_line_end"),
    ...(charStart === undefined ? {} : { charStart }),
    ...(charEnd === undefined ? {} : { charEnd }),
    ...(matchMode === undefined ? {} : { matchMode: matchMode as EvidenceMatchMode }),
    contentHash: requiredString("content_hash"),
    createdAt: requiredString("created_at"),
    citationEligible: metadata.get("citation_eligible") === true,
  };
}

export type EvidenceSummary = Pick<EvidenceNode, "id" | "question" | "claim" | "relation" | "provenance" | "confidence" | "citationEligible"> & {
  path: string;
};

export async function readEvidence(sessionDir: string, evidenceIdValue: string): Promise<{
  node: EvidenceNode;
  markdown: string;
  verification: { ok: boolean; errors: string[] };
}> {
  if (!/^ev_[a-f0-9]{16}$/.test(evidenceIdValue)) throw new Error("invalid evidence id");
  const rel = path.posix.join("evidence", `${evidenceIdValue}.md`);
  const evidencePath = await resolveExistingSessionPath(sessionDir, rel);
  const markdown = await readFile(evidencePath, "utf8");
  const node = parseEvidenceMarkdown(markdown);
  if (node.id !== evidenceIdValue) throw new Error("evidence id does not match filename");
  return { node, markdown, verification: await verifyEvidence(sessionDir, node) };
}

export async function listEvidence(sessionDir: string): Promise<EvidenceSummary[]> {
  const evidenceDir = path.join(sessionDir, "evidence");
  let names: string[];
  try {
    names = await readdir(evidenceDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const summaries: EvidenceSummary[] = [];
  for (const name of names.filter((item) => /^ev_[a-f0-9]{16}\.md$/.test(item)).sort()) {
    const id = name.slice(0, -3);
    const { node } = await readEvidence(sessionDir, id);
    summaries.push({
      id: node.id,
      question: node.question,
      claim: node.claim,
      relation: node.relation,
      provenance: node.provenance,
      confidence: node.confidence,
      citationEligible: node.citationEligible,
      path: path.posix.join("evidence", name),
    });
  }
  return summaries;
}

export async function verifyEvidence(sessionDir: string, node: EvidenceNode): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    const sourcePath = await resolveExistingSessionPath(sessionDir, node.sourcePath);
    const source = await readFile(sourcePath, "utf8");
    if (node.sourceId || node.documentId) {
      const identity = await sourceIdentityForPath(sessionDir, node.sourcePath);
      if (node.sourceId && identity.sourceId !== node.sourceId) errors.push("sourceId mismatch");
      if (node.documentId && identity.documentId !== node.documentId) errors.push("documentId mismatch");
    }
    const quote = node.charStart !== undefined && node.charEnd !== undefined
      ? source.slice(node.charStart, node.charEnd)
      : source.split("\n").slice(node.lineStart - 1, node.lineEnd).join("\n");
    if (quote !== node.quote) errors.push("quote does not match source location");
    const hash = createHash("sha256").update(node.quote).digest("hex");
    if (hash !== node.contentHash) errors.push("contentHash mismatch");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: errors.length === 0, errors };
}
