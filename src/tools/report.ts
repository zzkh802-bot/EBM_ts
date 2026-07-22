import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readEvidence } from "./evidence.js";
import { normalizeMarkdown } from "./markdown.js";

export type ReportWriteInput = {
  sessionDir: string;
  title: string;
  content: string;
  allowNoEvidence?: boolean;
};

export type ReportRecord = {
  path: string;
  title: string;
  evidenceIds: string[];
  sha256: string;
  createdAt: string;
};

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
  const content = normalizeMarkdown(input.content);
  if (!content.trim()) throw new Error("report content is required");
  const evidenceIds = [...new Set(content.match(/ev_[a-f0-9]{16}/g) ?? [])].sort();
  if (!evidenceIds.length && !input.allowNoEvidence) {
    throw new Error("report has no evidence references; set allowNoEvidence only for an explicit evidence-gap report");
  }
  for (const evidenceId of evidenceIds) {
    const record = await readEvidence(input.sessionDir, evidenceId);
    if (!record.node.citationEligible) throw new Error(`evidence ${evidenceId} is not citation eligible`);
    if (!record.verification.ok) {
      throw new Error(`evidence ${evidenceId} verification failed: ${record.verification.errors.join("; ")}`);
    }
  }
  const sha256 = createHash("sha256").update(`${title}\n${content}`).digest("hex");
  const createdAt = new Date().toISOString();
  const outDir = path.join(input.sessionDir, "reports");
  const baseName = slug(title);
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `created_at: ${JSON.stringify(createdAt)}`,
    `sha256: ${sha256}`,
    `evidence_status: ${evidenceIds.length ? "verified" : "gap"}`,
    `evidence_ids: ${JSON.stringify(evidenceIds)}`,
    "---",
    "",
  ].join("\n");
  await mkdir(outDir, { recursive: true });
  const archived = `${frontmatter}${content}\n`;
  for (let suffix = 1; ; suffix += 1) {
    const name = `${baseName}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const rel = path.posix.join("reports", name);
    const abs = path.join(outDir, name);
    try {
      await writeFile(abs, archived, { encoding: "utf8", flag: "wx" });
      return { path: rel, title, evidenceIds, sha256, createdAt };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existing = await readFile(abs, "utf8");
      if (existing.includes(`\nsha256: ${sha256}\n`)) {
        const existingCreatedAt = existing.match(/\ncreated_at: ("(?:[^"\\]|\\.)*")\n/)?.[1];
        return {
          path: rel,
          title,
          evidenceIds,
          sha256,
          createdAt: existingCreatedAt ? JSON.parse(existingCreatedAt) as string : createdAt,
        };
      }
    }
  }
}
