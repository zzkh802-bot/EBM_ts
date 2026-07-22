import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readEvidence } from "./evidence.js";
import { normalizeMarkdown } from "./markdown.js";
import { formatBeijingTimestamp } from "./time.js";

export type ReportReference = {
  number: number;
  citation: string;
  evidenceId: string;
};

export type ReportWriteInput = {
  sessionDir: string;
  title: string;
  content: string;
  references?: ReportReference[];
  allowNoEvidence?: boolean;
};

export type ReportRecord = {
  path: string;
  title: string;
  evidenceIds: string[];
  sha256: string;
  createdAt: string;
};

function renderReferenceSection(references: ReportReference[]): string {
  if (!references.length) return "";
  return [
    "## 参考文献",
    "",
    ...[...references]
      .sort((a, b) => a.number - b.number)
      .map((reference) => `[${reference.number}] ${reference.citation.trim()}`),
  ].join("\n");
}

const REFERENCE_HEADINGS = new Set([
  "参考文献",
  "参考资料",
  "参考来源",
  "资料来源",
  "引用文献",
  "引用资料",
  "参考",
  "文献",
  "资料",
  "references",
  "bibliography",
  "sources",
]);

function referenceHeadingMatch(line: string): RegExpExecArray | null {
  const match = /^(?:#{1,6}\s*)?(.*?)\s*$/.exec(line);
  if (!match) return null;
  return REFERENCE_HEADINGS.has(match[1]!.trim().toLowerCase()) ? match : null;
}

function ensureReferenceSection(content: string, references: ReportReference[]): string {
  if (!references.length) return content;
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => !!referenceHeadingMatch(line));
  const body = headingIndex >= 0 ? lines.slice(0, headingIndex).join("\n") : content;
  return normalizeMarkdown(`${body}\n\n${renderReferenceSection(references)}`);
}

function slug(value: string): string {
  const result = value.normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return Array.from(result).slice(0, 96).join("").replace(/-$/g, "") || "report";
}

export async function writeReport(input: ReportWriteInput): Promise<ReportRecord> {
  const title = input.title.trim();
  if (!title) throw new Error("report title is required");
  const references = input.references ?? [];
  const content = ensureReferenceSection(normalizeMarkdown(input.content), references);
  if (!content.trim()) throw new Error("report content is required");
  const evidenceIds = references.length
    ? [...new Set(references.map((reference) => reference.evidenceId))].sort()
    : [...new Set(content.match(/ev_[a-f0-9]{16}/g) ?? [])].sort();
  if (!evidenceIds.length && !input.allowNoEvidence) {
    throw new Error("report has no evidence references; set allowNoEvidence only for an explicit evidence-gap report");
  }
  if (references.length) {
    const numbers = new Set<number>();
    for (const reference of references) {
      if (!Number.isInteger(reference.number) || reference.number < 1) throw new Error("reference number must be a positive integer");
      if (numbers.has(reference.number)) throw new Error(`duplicate reference number: ${reference.number}`);
      numbers.add(reference.number);
      if (!reference.citation.trim()) throw new Error(`reference ${reference.number} citation is required`);
      if (!/^ev_[a-f0-9]{16}$/.test(reference.evidenceId)) throw new Error(`reference ${reference.number} has invalid evidence id`);
    }
    const citedNumbers = new Set(Array.from(content.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)).flatMap((match) => match[1]!.split(/\s*,\s*/).map(Number)));
    for (const cited of citedNumbers) {
      if (!numbers.has(cited)) throw new Error(`body citation [${cited}] has no matching reference entry`);
    }
  }
  for (const evidenceId of evidenceIds) {
    const record = await readEvidence(input.sessionDir, evidenceId);
    if (!record.node.citationEligible) throw new Error(`evidence ${evidenceId} is not citation eligible`);
    if (!record.verification.ok) {
      throw new Error(`evidence ${evidenceId} verification failed: ${record.verification.errors.join("; ")}`);
    }
  }
  const sha256 = createHash("sha256").update(`${title}\n${content}`).digest("hex");
  const createdAt = formatBeijingTimestamp();
  const outDir = path.join(input.sessionDir, "reports");
  const baseName = slug(title);
  const metadata = {
    title,
    created_at: createdAt,
    sha256,
    evidence_status: evidenceIds.length ? "verified" : "gap",
    evidence_ids: evidenceIds,
    references: references.map((reference) => ({ number: reference.number, citation: reference.citation, evidence_id: reference.evidenceId })),
  };
  await mkdir(outDir, { recursive: true });
  const archived = `${content}\n`;
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const rel = path.posix.join("reports", name);
    const abs = path.join(outDir, name);
    try {
      await writeFile(abs, archived, { encoding: "utf8", flag: "wx" });
      await writeFile(path.join(outDir, `${name}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return { path: rel, title, evidenceIds, sha256, createdAt };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = await readFile(abs, "utf8");
      const metadataPath = path.join(outDir, `${name}.metadata.json`);
      let existingMetadata: { sha256?: string; created_at?: string } | undefined;
      try {
        existingMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as { sha256?: string; created_at?: string };
      } catch {
        existingMetadata = undefined;
      }
      if (existing === archived || existingMetadata?.sha256 === sha256) {
        return { path: rel, title, evidenceIds, sha256, createdAt: existingMetadata?.created_at ?? createdAt };
      }
    }
  }
}
