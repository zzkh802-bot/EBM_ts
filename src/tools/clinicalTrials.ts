import { Agent, fetch as undiciFetch } from "undici";
import { archiveSource, type SourceArchiveRecord } from "./archive.js";

const clinicalTrialsDispatcher = new Agent({ connect: { family: 4 } });
const defaultClinicalTrialsFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  undiciFetch(input as string | URL, { ...(init as Record<string, unknown>), dispatcher: clinicalTrialsDispatcher }) as unknown as Promise<Response>
) as typeof fetch;

const CLINICAL_TRIALS_API = "https://clinicaltrials.gov/api/v2";

export type ClinicalTrialsError = {
  code: "invalid_input" | "identifier_not_found" | "clinicaltrials_request_failed" | "invalid_clinicaltrials_response";
  message: string;
  status?: number;
};

export type ClinicalTrialsSearchResult =
  | { ok: true; nctIds: string[]; studyCount: number; studyArchives: SourceArchiveRecord[]; warnings: string[]; archive: SourceArchiveRecord }
  | { ok: false; error: ClinicalTrialsError };

export type ClinicalTrialsReadResult =
  | { ok: true; nctId: string; archive: SourceArchiveRecord; warnings: string[] }
  | { ok: false; error: ClinicalTrialsError };

type FetchOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
};

type StudyProtocol = {
  protocolSection?: {
    identificationModule?: { nctId?: unknown; briefTitle?: unknown; officialTitle?: unknown; orgStudyIdInfo?: unknown; organization?: unknown };
    statusModule?: {
      overallStatus?: unknown;
      startDateStruct?: { date?: unknown; type?: unknown };
      completionDateStruct?: { date?: unknown; type?: unknown };
      expandedAccessInfo?: unknown;
    };
    sponsorCollaboratorsModule?: { leadSponsor?: unknown; collaborators?: unknown };
    descriptionModule?: { briefSummary?: unknown; detailedDescription?: unknown };
    conditionsModule?: { conditions?: unknown };
    designModule?: { studyType?: unknown; phases?: unknown; designInfo?: unknown; enrollmentInfo?: unknown };
    armsInterventionsModule?: { armGroups?: unknown; interventions?: unknown };
    outcomesModule?: { primaryOutcomes?: unknown; secondaryOutcomes?: unknown };
    eligibilityModule?: { eligibilityCriteria?: unknown; sex?: unknown; minimumAge?: unknown; maximumAge?: unknown; healthyVolunteers?: unknown; stdAges?: unknown };
    contactsLocationsModule?: { locations?: unknown };
    referencesModule?: { references?: unknown };
  };
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTimed(fetcher: typeof fetch, url: URL, timeoutMs: number, retries: number, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, headers: { "User-Agent": "EBM-Agent-TS/0.1" } });
      if ((response.status === 429 || response.status >= 500) && attemptIndex < retries) {
        await response.body?.cancel();
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attemptIndex >= retries) throw error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(250 * (2 ** attemptIndex));
  }
  throw lastError instanceof Error ? lastError : new Error("ClinicalTrials.gov request failed after retries");
}

async function requireOk(response: Response): Promise<ClinicalTrialsError | undefined> {
  if (response.ok) return undefined;
  const body = (await response.text()).trim().slice(0, 300);
  return { code: "clinicaltrials_request_failed", message: body || `ClinicalTrials.gov returned HTTP ${response.status}`, status: response.status };
}

function unknownError(error: unknown): ClinicalTrialsError {
  if (!(error instanceof Error)) return { code: "clinicaltrials_request_failed", message: String(error) };
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
    const causeMessage = "message" in cause && typeof cause.message === "string" ? cause.message : undefined;
    const detail = [code, causeMessage].filter(Boolean).join(": ");
    if (detail) return { code: "clinicaltrials_request_failed", message: `${error.message} (${detail})` };
  }
  return { code: "clinicaltrials_request_failed", message: error.message };
}

function asString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(asString).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => asString(child))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function itemLines(items: Array<Record<string, unknown>>, keys: Array<{ key: string; label: string; filter?: (value: unknown) => boolean }>): string[] {
  if (!items.length) return [];
  return items.flatMap((item, index) => {
    const parts = keys.flatMap(({ key, label, filter }) => {
      const value = item[key];
      if (value === undefined || value === null) return [];
      if (filter && !filter(value)) return [];
      const text = asString(value).trim();
      return text ? [`${label}: ${text}`] : [];
    });
    return parts.length ? [`- Group ${index + 1}:`, ...parts.map((part) => `  ${part}`)] : [];
  });
}

function renderStudy(markdown: StudyProtocol, warnings: string[] = [], options: { sourceStatus?: string } = {}): string {
  const section = markdown.protocolSection ?? {};
  const identification = section.identificationModule ?? {};
  const status = section.statusModule ?? {};
  const sponsor = section.sponsorCollaboratorsModule ?? {};
  const description = section.descriptionModule ?? {};
  const conditions = section.conditionsModule ?? {};
  const design = section.designModule ?? {};
  const arms = section.armsInterventionsModule ?? {};
  const outcomes = section.outcomesModule ?? {};
  const eligibility = section.eligibilityModule ?? {};
  const organization = asString(identification.organization).trim();
  const lines = [
    `# ${asString(identification.briefTitle) || `Clinical trial ${asString(identification.nctId) || ""}`}`,
    "",
    `NCT ID: ${asString(identification.nctId)}`,
    ...(asString(identification.officialTitle).trim() ? [`Official title: ${asString(identification.officialTitle)}`] : []),
    ...(organization ? [`Organization: ${organization}`] : []),
    `Overall status: ${asString(status.overallStatus) || "unknown"}`,
    ...(status.startDateStruct && asString(status.startDateStruct.date).trim() ? [`Start date: ${asString(status.startDateStruct.date)}`] : []),
    ...(status.completionDateStruct && asString(status.completionDateStruct.date).trim() ? [`Completion date: ${asString(status.completionDateStruct.date)}`] : []),
    "Source status: clinicaltrials.gov trial registration",
    ...(options.sourceStatus ? [`Registry source: ${options.sourceStatus}`] : []),
    "",
  ];
  const leadSponsor = asString(sponsor.leadSponsor).trim();
  const collaborators = asArray(sponsor.collaborators).map((item) => asString(typeof item === "object" ? (item as Record<string, unknown>).name : item)).filter(Boolean);
  if (leadSponsor || collaborators.length) {
    lines.push("## Sponsor / Collaborators", "", ...(leadSponsor ? [`- Lead sponsor: ${leadSponsor}`] : []), ...collaborators.map((collaborator) => `- Collaborator: ${collaborator}`), "");
  }
  const briefSummary = asString(description.briefSummary).trim();
  const detailedDescription = asString(description.detailedDescription).trim();
  if (briefSummary || detailedDescription) {
    lines.push("## Description", "", ...(briefSummary ? [`${briefSummary}`, ""] : []), ...(detailedDescription ? ["### Detailed description", "", detailedDescription, ""] : []));
  }
  const conditionList = asArray(conditions.conditions).map((item) => asString(item)).filter(Boolean);
  if (conditionList.length) lines.push("## Conditions", "", ...conditionList.map((condition) => `- ${condition}`), "");
  const studyType = asString(design.studyType).trim();
  const phases = asArray(design.phases).map((item) => asString(item)).filter(Boolean);
  const designInfo = design.designInfo ? Object.entries(design.designInfo as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null && asString(value).trim()).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${asString(value)}`).join("; ") : "";
  const enrollment = design.enrollmentInfo ? `${asString((design.enrollmentInfo as Record<string, unknown>).count)} (${asString((design.enrollmentInfo as Record<string, unknown>).type) || "unknown"})` : "";
  if (studyType || phases.length || designInfo || enrollment) {
    lines.push("## Design", "", ...[
      ...(studyType ? [`- Study type: ${studyType}`] : []),
      ...(phases.length ? [`- Phase(s): ${phases.join(", ")}`] : []),
      ...(designInfo ? [`- Design: ${designInfo}`] : []),
      ...(enrollment ? [`- Enrollment: ${enrollment}`] : []),
    ], "");
  }
  const armGroups = asArray(arms.armGroups);
  const interventions = asArray(arms.interventions);
  if (armGroups.length || interventions.length) {
    lines.push("## Arms / Interventions", "");
    if (armGroups.length) {
      lines.push("### Arms", "", ...armGroups.map((arm, index) => {
        const label = asString((arm as Record<string, unknown>).label).trim();
        const descriptionText = asString((arm as Record<string, unknown>).description).trim();
        return [`- ${index + 1}. ${label}`, ...(descriptionText ? [`  ${descriptionText}`] : [])].join("\n");
      }), "");
    }
    if (interventions.length) {
      lines.push("### Interventions", "", ...interventions.map((intervention, index) => {
        const name = asString((intervention as Record<string, unknown>).name).trim();
        const type = asString((intervention as Record<string, unknown>).type).trim();
        const descriptionText = asString((intervention as Record<string, unknown>).description).trim();
        const label = [type, name].filter(Boolean).join(": ") || `Intervention ${index + 1}`;
        return [label, ...(descriptionText ? [`  ${descriptionText}`] : [])].join("\n");
      }), "");
    }
  }
  const primaryOutcomes = asArray(outcomes.primaryOutcomes);
  const secondaryOutcomes = asArray(outcomes.secondaryOutcomes);
  if (primaryOutcomes.length || secondaryOutcomes.length) {
    lines.push("## Outcome Measures", "");
    if (primaryOutcomes.length) lines.push("### Primary outcomes", ...(primaryOutcomes.flatMap((outcome) => {
      const measure = asString((outcome as Record<string, unknown>).measure).trim();
      const descriptionText = asString((outcome as Record<string, unknown>).description).trim();
      const timeFrame = asString((outcome as Record<string, unknown>).timeFrame).trim();
      return [`- ${measure}`, ...(timeFrame ? [`  Time frame: ${timeFrame}`] : []), ...(descriptionText ? [`  ${descriptionText}`] : [])];
    })), "");
    if (secondaryOutcomes.length) lines.push("### Secondary outcomes", ...(secondaryOutcomes.flatMap((outcome) => {
      const measure = asString((outcome as Record<string, unknown>).measure).trim();
      const descriptionText = asString((outcome as Record<string, unknown>).description).trim();
      const timeFrame = asString((outcome as Record<string, unknown>).timeFrame).trim();
      return [`- ${measure}`, ...(timeFrame ? [`  Time frame: ${timeFrame}`] : []), ...(descriptionText ? [`  ${descriptionText}`] : [])];
    })), "");
  }
  const eligibilityCriteria = asString(eligibility.eligibilityCriteria).trim();
  const eligibilityLines = [
    ...(eligibilityCriteria ? [eligibilityCriteria] : []),
    ...(asString(eligibility.sex).trim() ? [`Sex: ${asString(eligibility.sex)}`] : []),
    ...(asString(eligibility.minimumAge).trim() ? [`Minimum age: ${asString(eligibility.minimumAge)}`] : []),
    ...(asString(eligibility.maximumAge).trim() ? [`Maximum age: ${asString(eligibility.maximumAge)}`] : []),
    ...(asString(eligibility.healthyVolunteers) ? [`Healthy volunteers: ${asString(eligibility.healthyVolunteers)}`] : []),
  ];
  if (eligibilityLines.some((line) => line.trim())) lines.push("## Eligibility", "", ...eligibilityLines, "");
  const locations = asArray(section.contactsLocationsModule?.locations);
  if (locations.length) {
    lines.push("## Locations", "", ...locations.slice(0, 10).map((location) => {
      const item = location as Record<string, unknown>;
      const facility = asString(item.facility).trim();
      const city = asString(item.city).trim();
      const country = asString(item.country).trim();
      const statusText = asString(item.status).trim();
      return `- ${[facility, [city, country].filter(Boolean).join(", ")].filter(Boolean).join(", ")}${statusText ? ` (${statusText})` : ""}`;
    }), ...(locations.length > 10 ? [`- ... and ${locations.length - 10} more`] : []), "");
  }
  const references = asArray(section.referencesModule?.references);
  if (references.length) {
    lines.push("## References", "", ...references.filter((reference) => {
      try {
        new URL(asString((reference as Record<string, unknown>).reference).trim() || "");
        return false;
      } catch {
        return false;
      }
    }).map((reference) => {
      const item = reference as Record<string, unknown>;
      return `- ${asString(item.citation).trim()}${asString(item.reference).trim() ? ` (${asString(item.reference).trim()})` : ""}`;
    }), "");
  }
  if (warnings.length) lines.push("## Retrieval notes", "", ...warnings.map((warning) => `- ${warning}`), "");
  return lines.join("\n");
}

export async function searchClinicalTrials(input: {
  sessionDir: string;
  query: string;
  maxResults?: number;
} & FetchOptions): Promise<ClinicalTrialsSearchResult> {
  if (!input.query.trim()) return { ok: false, error: { code: "invalid_input", message: "ClinicalTrials.gov query is required" } };
  const fetcher = input.fetcher ?? defaultClinicalTrialsFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 120_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  try {
    const searchUrl = new URL(`${CLINICAL_TRIALS_API}/studies`);
    searchUrl.searchParams.set("query.term", input.query);
    searchUrl.searchParams.set("pageSize", String(Math.min(Math.max(input.maxResults ?? 10, 1), 50)));
    const response = await fetchTimed(fetcher, searchUrl, timeoutMs, retries, operationSignal);
    const failure = await requireOk(response);
    if (failure) return { ok: false, error: failure };
    const payload = await response.json() as { studies?: unknown; nextPageToken?: unknown };
    if (!Array.isArray(payload.studies)) {
      return { ok: false, error: { code: "invalid_clinicaltrials_response", message: "ClinicalTrials.gov search response has no studies list" } };
    }
    const studies = payload.studies as StudyProtocol[];
    const nctIds = studies.map((study) => asString(study.protocolSection?.identificationModule?.nctId)).filter(Boolean);
    const studyArchives = await Promise.all(studies.map((study) => archiveSource({
      sessionDir: input.sessionDir,
      kind: "read",
      sourceUrl: `https://clinicaltrials.gov/study/${asString(study.protocolSection?.identificationModule?.nctId)}`,
      title: asString(study.protocolSection?.identificationModule?.briefTitle) || `Clinical trial ${asString(study.protocolSection?.identificationModule?.nctId) || ""}`,
      content: renderStudy(study),
    })));
    const lines = [
      `# ClinicalTrials.gov search: ${input.query}`,
      "",
      `Status: ${studies.length ? "completed" : "no_results"}`,
      `Results returned: ${studies.length}`,
      ...(payload.nextPageToken ? [`More results available (pagination token present); re-run with a more specific query to narrow.`] : []),
      ...(studies.length ? [] : ["", "No ClinicalTrials.gov studies matched this query."]),
      "",
    ];
    if (studies.length) {
      lines.push("## Result index", "", "Trial registration pages appear later in this file. Use the separate `sources/read/` path for evidence.", "");
      studies.forEach((study, index) => {
        const identification = study.protocolSection?.identificationModule ?? {};
        const nctId = asString(identification.nctId);
        lines.push(`- ${index + 1}. ${asString(identification.briefTitle) || "Clinical trial"}${nctId ? ` (${nctId})` : ""} — overall status: ${asString(study.protocolSection?.statusModule?.overallStatus) || "unknown"}`);
      });
      lines.push("");
    }
    if (studies.length) lines.push("## Registered trial summaries", "");
    studies.forEach((study, index) => {
      const title = asString(study.protocolSection?.identificationModule?.briefTitle) || `Clinical trial ${index + 1}`;
      lines.push(`### ${index + 1}. ${title}`, "", `NCT ID: ${asString(study.protocolSection?.identificationModule?.nctId)}`, `Overall status: ${asString(study.protocolSection?.statusModule?.overallStatus) || "unknown"}`, `Conditions: ${asArray(study.protocolSection?.conditionsModule?.conditions).map((item) => asString(item)).join(", ") || "not listed"}`, "");
    });
    return {
      ok: true,
      nctIds,
      studyCount: studies.length,
      studyArchives,
      warnings: [],
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "search",
        sourceUrl: `https://clinicaltrials.gov/search?term=${encodeURIComponent(input.query)}`,
        title: input.query,
        content: lines.join("\n"),
      }),
    };
  } catch (error) {
    return { ok: false, error: unknownError(error) };
  }
}

export async function readClinicalTrial(input: {
  sessionDir: string;
  nctId: string;
} & FetchOptions): Promise<ClinicalTrialsReadResult> {
  const nctId = input.nctId.trim().toUpperCase().replace(/^(?:NCT|STUDY)\s*:/i, "");
  if (!/^NCT\d{6,}$/i.test(nctId)) return { ok: false, error: { code: "invalid_input", message: "A ClinicalTrials.gov NCT identifier (e.g. NCT03827343) is required" } };
  const fetcher = input.fetcher ?? defaultClinicalTrialsFetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const retries = input.retries ?? 2;
  const totalSignal = AbortSignal.timeout(input.totalTimeoutMs ?? 120_000);
  const operationSignal = input.signal ? AbortSignal.any([input.signal, totalSignal]) : totalSignal;
  try {
    const url = new URL(`${CLINICAL_TRIALS_API}/studies/${nctId}`);
    const response = await fetchTimed(fetcher, url, timeoutMs, retries, operationSignal);
    if (response.status === 404) return { ok: false, error: { code: "identifier_not_found", message: `ClinicalTrials.gov has no study ${nctId}` } };
    const failure = await requireOk(response);
    if (failure) return { ok: false, error: failure };
    const study = await response.json() as StudyProtocol;
    if (!study.protocolSection) {
      return { ok: false, error: { code: "invalid_clinicaltrials_response", message: "ClinicalTrials.gov study response has no protocol section" } };
    }
    const title = asString(study.protocolSection.identificationModule?.briefTitle) || `Clinical trial ${nctId}`;
    return {
      ok: true,
      nctId,
      warnings: [],
      archive: await archiveSource({
        sessionDir: input.sessionDir,
        kind: "read",
        sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
        title,
        content: renderStudy(study),
      }),
    };
  } catch (error) {
    return { ok: false, error: unknownError(error) };
  }
}