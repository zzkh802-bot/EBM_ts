import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return result || "report";
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
  const rel = path.posix.join("reports", `${slug(title)}-${sha256.slice(0, 12)}.md`);
  const abs = path.join(input.sessionDir, rel);
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
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${frontmatter}${content}\n`, "utf8");
  return { path: rel, title, evidenceIds, sha256, createdAt };
}
