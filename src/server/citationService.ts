import { readFile } from "node:fs/promises";
import { readEvidence } from "../tools/evidence.js";
import { safeWorkspaceFile, sessionWorkspace, WorkspaceServiceError } from "./workspaceService.js";

export type ReportMetadataReference = {
  number: number;
  citation: string;
  evidence_ids?: string[];
  evidence_id?: string;
};

type ResolvedCitation = {
  workspace: string;
  reference: ReportMetadataReference;
  evidenceIds: string[];
  fallbackUrl: string;
};

function archiveFrontmatterValue(markdown: string, key: "title" | "source_url" | "source_institution"): string {
  if (!markdown.startsWith("---\n")) return "";
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return "";
  const prefix = `${key}:`;
  const line = markdown.slice(4, end).split("\n").find((item) => item.startsWith(prefix));
  if (!line) return "";
  const raw = line.slice(prefix.length).trim();
  try {
    return raw.startsWith('"') ? String(JSON.parse(raw)) : raw;
  } catch {
    return "";
  }
}

function publicSourceUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

async function resolveCitation(rootDir: string, sessionId: string, reportPath: string, number: number): Promise<ResolvedCitation> {
  if (!/^reports\/(?!drafts\/).+\.md$/.test(reportPath)) {
    throw new WorkspaceServiceError(422, "invalid_report_path", "请选择正式报告后查看引用。 ");
  }
  const workspace = await sessionWorkspace(rootDir, sessionId);
  try {
    await safeWorkspaceFile(workspace, reportPath);
  } catch {
    throw new WorkspaceServiceError(404, "report_not_found", "未找到该正式报告。 ");
  }
  let metadata: { references?: ReportMetadataReference[] };
  try {
    const metadataAbsolute = await safeWorkspaceFile(workspace, `${reportPath}.metadata.json`);
    metadata = JSON.parse(await readFile(metadataAbsolute, "utf8")) as { references?: ReportMetadataReference[] };
  } catch {
    throw new WorkspaceServiceError(404, "citation_metadata_not_found", "这份历史报告尚未保存可核验的引用映射。 ");
  }
  const reference = Array.isArray(metadata.references)
    ? metadata.references.find((item) => item && item.number === number && typeof item.citation === "string")
    : undefined;
  if (!reference) throw new WorkspaceServiceError(404, "citation_not_found", `报告中未找到引用 [${number}]。`);
  const evidenceIds = [...new Set([
    ...(Array.isArray(reference.evidence_ids) ? reference.evidence_ids : []),
    ...(typeof reference.evidence_id === "string" ? [reference.evidence_id] : []),
  ])];
  const pmid = /PMID[:\s]+(\d{6,9})/i.exec(reference.citation)?.[1] ?? "";
  const fallbackUrl = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";
  return { workspace, reference, evidenceIds, fallbackUrl };
}

async function citationArchive(workspace: string, reference: ReportMetadataReference, fallbackUrl: string, evidenceId: string) {
  const record = await readEvidence(workspace, evidenceId);
  const sourceAbsolute = await safeWorkspaceFile(workspace, record.node.sourcePath);
  const sourceMarkdown = await readFile(sourceAbsolute, "utf8");
  const sourceTitle = archiveFrontmatterValue(sourceMarkdown, "title") || reference.citation.slice(0, 180);
  const archivedSourceUrl = archiveFrontmatterValue(sourceMarkdown, "source_url");
  const sourceUrl = publicSourceUrl(archivedSourceUrl) || fallbackUrl;
  const sourceInstitution = archiveFrontmatterValue(sourceMarkdown, "source_institution");
  return { record, sourceTitle, sourceUrl, sourceInstitution };
}

export async function readCitationDetail(rootDir: string, sessionId: string, reportPath: string, number: number): Promise<Record<string, unknown>> {
  const { workspace, reference, evidenceIds, fallbackUrl } = await resolveCitation(rootDir, sessionId, reportPath, number);
  const evidence = await Promise.all(evidenceIds.map(async (evidenceId) => {
    try {
      const { record, sourceTitle, sourceUrl, sourceInstitution } = await citationArchive(workspace, reference, fallbackUrl, evidenceId);
      if (!record.verification.ok) throw new Error("evidence verification failed");
      return {
        claim: record.node.claim,
        quote: record.node.quote,
        relation: record.node.relation,
        provenance: record.node.provenance,
        confidence: record.node.confidence,
        verified: true,
        source: {
          title: sourceTitle,
          institution: sourceInstitution,
          url: sourceUrl,
        },
      };
    } catch {
      throw new WorkspaceServiceError(409, "citation_evidence_unavailable", "该引用的证据片段暂时无法重新核验。 ");
    }
  }));
  return { number, citation: reference.citation, evidence };
}
