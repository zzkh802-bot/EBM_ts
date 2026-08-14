import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readEvidence } from "./evidence.js";
import { normalizeMarkdown } from "./markdown.js";
import { formatBeijingTimestamp } from "./time.js";

export type ReportReference = {
  number: number;
  citation: string;
  evidenceId: string;
};

type NormalizedReportReference = {
  number: number;
  citation: string;
  evidenceIds: string[];
  sourceNumbers: number[];
};

export type ReportWriteInput = {
  sessionDir: string;
  title: string;
  content: string;
  references?: ReportReference[];
  allowNoEvidence?: boolean;
};

export type ReportNormalization = {
  contentChanged: boolean;
  referencesRebuilt: boolean;
  referenceNumbersCompacted: boolean;
  referenceNumberMap: Array<{ from: number; to: number }>;
  finalReferenceCount: number;
};

export type ReportRecord = {
  path: string;
  title: string;
  evidenceIds: string[];
  sha256: string;
  createdAt: string;
  normalization: ReportNormalization;
};

export type ReportDraftRecord = {
  path: string;
  title: string;
  sha256: string;
  createdAt: string;
  error: string;
  normalization: ReportNormalization;
};

function renderReferenceEntry(entry: string): string {
  const match = /^\[(\d+)\]\s+(.*)$/.exec(entry.trim());
  if (!match) return entry.trim();
  return `${match[1]}. [${match[1]}] ${match[2]!.trim()}`;
}

function renderReferenceSection(references: Array<{ number: number; citation: string }>): string {
  if (!references.length) return "";
  return [
    "## 参考文献",
    "",
    ...[...references]
      .sort((a, b) => a.number - b.number)
      .map((reference) => `${reference.number}. [${reference.number}] ${reference.citation.trim()}`),
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

function splitReferenceEntries(section: string): string[] {
  const compact = section.replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const entries = compact.split(/\s+(?=\[\d+\]\s+)/).map((entry) => entry.trim()).filter(Boolean);
  return entries.length && entries.every((entry) => /^\[\d+\]\s+/.test(entry)) ? entries : [];
}

function canonicalizeExistingReferenceSection(content: string): string {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => !!referenceHeadingMatch(line));
  if (headingIndex < 0) return content;
  const body = lines.slice(0, headingIndex).join("\n");
  const entries = splitReferenceEntries(lines.slice(headingIndex + 1).join("\n"));
  if (!entries.length) return content;
  return normalizeMarkdown(`${body}\n\n## 参考文献\n\n${entries.map(renderReferenceEntry).join("\n")}`);
}

function reportBodyBeforeReferences(content: string): string {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => !!referenceHeadingMatch(line));
  return headingIndex >= 0 ? lines.slice(0, headingIndex).join("\n") : content;
}

function ensureReferenceSection(content: string, references: Array<{ number: number; citation: string }>): string {
  if (!references.length) return canonicalizeExistingReferenceSection(content);
  const body = reportBodyBeforeReferences(content);
  return normalizeMarkdown(`${body}\n\n${renderReferenceSection(references)}`);
}

function normalizeReferenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeReferences(references: ReportReference[]): NormalizedReportReference[] {
  const byNumber = new Map<number, { number: number; citation: string; evidenceIds: string[] }>();
  for (const reference of references) {
    const citation = reference.citation.trim();
    const existing = byNumber.get(reference.number);
    if (!existing) {
      byNumber.set(reference.number, { number: reference.number, citation, evidenceIds: [reference.evidenceId] });
      continue;
    }
    if (normalizeReferenceText(existing.citation) !== normalizeReferenceText(citation)) {
      throw new Error(`duplicate reference number ${reference.number} has conflicting citations`);
    }
    if (!existing.evidenceIds.includes(reference.evidenceId)) existing.evidenceIds.push(reference.evidenceId);
  }

  const byCitation = new Map<string, NormalizedReportReference>();
  for (const reference of byNumber.values()) {
    const key = normalizeReferenceText(reference.citation);
    const existing = byCitation.get(key);
    if (!existing) {
      byCitation.set(key, {
        number: reference.number,
        citation: reference.citation,
        evidenceIds: [...reference.evidenceIds],
        sourceNumbers: [reference.number],
      });
      continue;
    }
    existing.number = Math.min(existing.number, reference.number);
    existing.sourceNumbers.push(reference.number);
    for (const evidenceId of reference.evidenceIds) {
      if (!existing.evidenceIds.includes(evidenceId)) existing.evidenceIds.push(evidenceId);
    }
  }
  const merged = [...byCitation.values()]
    .map((reference) => ({ ...reference, evidenceIds: [...reference.evidenceIds].sort(), sourceNumbers: [...new Set(reference.sourceNumbers)].sort((a, b) => a - b) }))
    .sort((a, b) => a.number - b.number);
  // Reference numbers are presentation indices, not stable source IDs. Once
  // duplicate citations are merged, compact them to 1..N so reports cannot
  // retain gaps such as [1], [2], [3], [6], [7]. remapBodyCitationNumbers
  // uses sourceNumbers to update the body citations accordingly.
  return merged.map((reference, index) => ({ ...reference, number: index + 1 }));
}

function remapBodyCitationNumbers(content: string, references: NormalizedReportReference[]): string {
  if (!references.length) return content;
  const mapping = new Map<number, number>();
  for (const reference of references) {
    for (const number of reference.sourceNumbers) mapping.set(number, reference.number);
  }
  const body = reportBodyBeforeReferences(content);
  const suffix = content.slice(body.length);
  const remappedBody = body.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_match, group: string) => {
    const numbers = group.split(/\s*,\s*/).map(Number).map((number) => mapping.get(number) ?? number);
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    return `[${unique.join(",")}]`;
  });
  return `${remappedBody}${suffix}`;
}

function normalizationSummary(original: string, finalContent: string, references: NormalizedReportReference[]): ReportNormalization {
  const referenceNumberMap = references.flatMap((reference) => reference.sourceNumbers
    .filter((from) => from !== reference.number)
    .map((from) => ({ from, to: reference.number })));
  return {
    contentChanged: finalContent !== original,
    referencesRebuilt: references.length > 0,
    referenceNumbersCompacted: referenceNumberMap.length > 0,
    referenceNumberMap,
    finalReferenceCount: references.length,
  };
}

function slug(value: string): string {
  const result = value.normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return Array.from(result).slice(0, 96).join("").replace(/-$/g, "") || "report";
}

export async function writeReportDraft(input: ReportWriteInput, error: string): Promise<ReportDraftRecord> {
  const title = input.title.trim() || "report draft";
  let draftReferences: Array<{ number: number; citation: string }> = input.references ?? [];
  let normalizedReferences: NormalizedReportReference[] = [];
  if (input.references?.length) {
    try {
      normalizedReferences = normalizeReferences(input.references);
      draftReferences = normalizedReferences;
    } catch {
      draftReferences = input.references;
    }
  }
  const content = (draftReferences.length
    ? ensureReferenceSection(normalizeMarkdown(input.content), draftReferences).replace(
      "## 参考文献\n\n",
      "## 参考文献\n\n<!-- 这里只是草稿预览：report_finalize/report_write 会根据 references 参数重新生成本节。修改引用时请同时修改 references 参数，不要只改这段预览。 -->\n\n",
    )
    : normalizeMarkdown(input.content));
  const normalization = normalizationSummary(input.content, content, normalizedReferences);
  const sha256 = createHash("sha256").update(`${title}\n${content}`).digest("hex");
  const createdAt = formatBeijingTimestamp();
  const outDir = path.join(input.sessionDir, "reports", "drafts");
  const baseName = slug(title);
  await mkdir(outDir, { recursive: true });
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.draft.md`;
    const rel = path.posix.join("reports", "drafts", name);
    const abs = path.join(outDir, name);
    try {
      await writeFile(abs, `${content}\n`, { encoding: "utf8", flag: "wx" });
      return { path: rel, title, sha256, createdAt, error, normalization };
    } catch (writeError) {
      if (!(writeError instanceof Error && "code" in writeError && writeError.code === "EEXIST")) throw writeError;
    }
  }
}

export async function writeReport(input: ReportWriteInput): Promise<ReportRecord> {
  const title = input.title.trim();
  if (!title) throw new Error("report title is required");
  const references = normalizeReferences(input.references ?? []);
  const normalizedContent = normalizeMarkdown(input.content);
  const content = ensureReferenceSection(remapBodyCitationNumbers(normalizedContent, references), references);
  const normalization = normalizationSummary(input.content, content, references);
  if (!content.trim()) throw new Error("report content is required");
  const evidenceIds = references.length
    ? [...new Set(references.flatMap((reference) => reference.evidenceIds))].sort()
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
      for (const evidenceId of reference.evidenceIds) {
        if (!/^ev_[a-f0-9]{16}$/.test(evidenceId)) throw new Error(`reference ${reference.number} has invalid evidence id`);
      }
    }
    const body = reportBodyBeforeReferences(content);
    const citedNumbers = new Set(Array.from(body.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)).flatMap((match) => match[1]!.split(/\s*,\s*/).map(Number)));
    if (!citedNumbers.size) throw new Error("report body has no numbered citations for the provided references");
    for (const cited of citedNumbers) {
      if (!numbers.has(cited)) throw new Error(`body citation [${cited}] has no matching reference entry`);
    }
    for (const number of numbers) {
      if (!citedNumbers.has(number)) throw new Error(`reference [${number}] is not cited in the report body`);
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
    references: references.map((reference) => ({
      number: reference.number,
      citation: reference.citation,
      evidence_ids: reference.evidenceIds,
      evidence_id: reference.evidenceIds[0],
    })),
  };
  await mkdir(outDir, { recursive: true });
  const archived = `${content}\n`;
  const serializedMetadata = `${JSON.stringify(metadata, null, 2)}\n`;
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const rel = path.posix.join("reports", name);
    const abs = path.join(outDir, name);
    const metadataPath = path.join(outDir, `${name}.metadata.json`);
    let createdReport = false;
    try {
      await writeFile(abs, archived, { encoding: "utf8", flag: "wx" });
      createdReport = true;
      await writeFile(metadataPath, serializedMetadata, { encoding: "utf8", flag: "wx" });
      return { path: rel, title, evidenceIds, sha256, createdAt, normalization };
    } catch (error) {
      const alreadyExists = error instanceof Error && "code" in error && error.code === "EEXIST";
      if (!alreadyExists) {
        if (createdReport) await rm(abs, { force: true });
        throw error;
      }
      let existing: string;
      try {
        existing = await readFile(abs, "utf8");
      } catch {
        if (createdReport) await rm(abs, { force: true });
        continue;
      }
      let existingMetadata: { sha256?: string; created_at?: string } | undefined;
      try {
        existingMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as { sha256?: string; created_at?: string };
      } catch {
        existingMetadata = undefined;
      }
      if (existing === archived && existingMetadata?.sha256 === sha256) {
        return { path: rel, title, evidenceIds, sha256, createdAt: existingMetadata?.created_at ?? createdAt, normalization };
      }
      if (existing === archived && !existingMetadata && !createdReport) {
        try {
          await writeFile(metadataPath, serializedMetadata, { encoding: "utf8", flag: "wx" });
          return { path: rel, title, evidenceIds, sha256, createdAt, normalization };
        } catch (metadataError) {
          if (!(metadataError instanceof Error && "code" in metadataError && metadataError.code === "EEXIST")) throw metadataError;
          try {
            const recovered = JSON.parse(await readFile(metadataPath, "utf8")) as { sha256?: string; created_at?: string };
            if (recovered.sha256 === sha256) return { path: rel, title, evidenceIds, sha256, createdAt: recovered.created_at ?? createdAt, normalization };
          } catch {
            // A concurrent writer may still be completing the sidecar; use a fresh suffix below.
          }
        }
      }
      if (createdReport) await rm(abs, { force: true });
    }
  }
}
