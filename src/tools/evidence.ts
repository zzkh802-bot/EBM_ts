import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export type EvidenceRelation = "supports" | "partially_supports" | "refutes";

export type EvidenceNode = {
  id: string;
  question: string;
  claim: string;
  relation: EvidenceRelation;
  sourcePath: string;
  quote: string;
  lineStart: number;
  lineEnd: number;
  contentHash: string;
  createdAt: string;
  citationEligible: boolean;
};

export type EvidenceAddInput = {
  sessionDir: string;
  question: string;
  claim: string;
  relation: EvidenceRelation;
  sourcePath: string;
  offset: number;
  limit: number;
};

function assertRelativeSafe(rel: string): void {
  if (!rel || rel.startsWith("/") || rel.includes("\0") || rel.split(/[\\/]+/).includes("..")) {
    throw new Error(`unsafe relative path: ${rel}`);
  }
}

function evidenceId(input: Omit<EvidenceNode, "id" | "createdAt" | "citationEligible">): string {
  return `ev_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16)}`;
}

export async function addEvidence(input: EvidenceAddInput): Promise<EvidenceNode> {
  assertRelativeSafe(input.sourcePath);
  if (input.limit <= 0) throw new Error("limit must be positive");
  if (input.offset < 0) throw new Error("offset must be non-negative");
  if (!input.question.trim()) throw new Error("question is required");
  if (!input.claim.trim()) throw new Error("claim is required");

  const sourceAbs = path.join(input.sessionDir, input.sourcePath);
  const text = await readFile(sourceAbs, "utf8");
  const lines = text.split("\n");
  const selected = lines.slice(input.offset, input.offset + input.limit);
  if (selected.length !== input.limit) throw new Error("source line range is outside source file");
  const quote = selected.join("\n");
  const contentHash = createHash("sha256").update(quote).digest("hex");
  const base = {
    question: input.question.trim(),
    claim: input.claim.trim(),
    relation: input.relation,
    sourcePath: input.sourcePath,
    quote,
    lineStart: input.offset,
    lineEnd: input.offset + input.limit - 1,
    contentHash,
  };
  const node: EvidenceNode = {
    id: evidenceId(base),
    ...base,
    createdAt: new Date().toISOString(),
    citationEligible: true,
  };
  const outDir = path.join(input.sessionDir, "evidence");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${node.id}.json`), `${JSON.stringify(node, null, 2)}\n`, "utf8");
  return node;
}

export async function verifyEvidence(sessionDir: string, node: EvidenceNode): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    assertRelativeSafe(node.sourcePath);
    const source = await readFile(path.join(sessionDir, node.sourcePath), "utf8");
    const quote = source.split("\n").slice(node.lineStart, node.lineEnd + 1).join("\n");
    if (quote !== node.quote) errors.push("quote does not match source slice");
    const hash = createHash("sha256").update(node.quote).digest("hex");
    if (hash !== node.contentHash) errors.push("contentHash mismatch");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: errors.length === 0, errors };
}
