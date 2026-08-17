import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readClinicalTrial, searchClinicalTrials } from "../src/tools/clinicalTrials.js";

function mockFetch(responses: Response[]) {
  const urls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    urls.push(String(input));
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  return { fetcher: fetcher as typeof fetch, urls };
}

const aspiritStudy = {
  protocolSection: {
    identificationModule: {
      nctId: "NCT03827343",
      briefTitle: "Aspirin for primary prevention in high-risk adults",
      officialTitle: "A randomized trial of daily aspirin for primary prevention",
      organization: { fullName: "Example Health Research Institute" },
    },
    statusModule: {
      overallStatus: "RECRUITING",
      startDateStruct: { date: "2023-01-15", type: "ACTUAL" },
      completionDateStruct: { date: "2026-06-30", type: "ESTIMATED" },
    },
    sponsorCollaboratorsModule: { leadSponsor: { name: "Example Health Research Institute" }, collaborators: [{ name: "National Example Foundation" }] },
    descriptionModule: {
      briefSummary: "Tests whether daily low-dose aspirin reduces major cardiovascular events.",
      detailedDescription: "A multi-center randomized controlled trial with 2000 participants.",
    },
    conditionsModule: { conditions: ["Cardiovascular Diseases"] },
    designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE3"], designInfo: { allocation: "RANDOMIZED", masking: "DOUBLE" }, enrollmentInfo: { count: 2000, type: "ANTICIPATED" } },
    armsInterventionsModule: {
      armGroups: [{ label: "Aspirin 100 mg", description: "Daily aspirin 100 mg" }],
      interventions: [{ type: "DRUG", name: "Aspirin", description: "100 mg daily" }],
    },
    outcomesModule: {
      primaryOutcomes: [{ measure: "Major adverse cardiovascular events", timeFrame: "5 years" }],
      secondaryOutcomes: [{ measure: "All-cause mortality", timeFrame: "5 years" }],
    },
    eligibilityModule: { eligibilityCriteria: "Ages 50-70 years with elevated cardiovascular risk.", sex: "ALL", minimumAge: "50 Years", maximumAge: "70 Years", healthyVolunteers: "No" },
    contactsLocationsModule: { locations: [{ facility: "Central Hospital", city: "Beijing", country: "China", status: "RECRUITING" }] },
    referencesModule: { references: [{ citation: "Example J. Prior work. Eur J 2020.", reference: "https://europepmc.org/article/MED/123" }] },
  },
};

describe("ClinicalTrials.gov archive adapters", () => {
  it("searches trials and archives each study as a citation-capable source", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-clinicaltrials-"));
    const mock = mockFetch([
      Response.json({ studies: [aspiritStudy], nextPageToken: "token-2" }),
    ]);

    const result = await searchClinicalTrials({ sessionDir, query: "AREA[Condition] Aspirin", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nctIds).toEqual(["NCT03827343"]);
    expect(result.studyCount).toBe(1);
    expect(result.studyArchives).toHaveLength(1);
    expect(result.studyArchives[0]!.sourceUrl).toBe("https://clinicaltrials.gov/study/NCT03827343");
    expect(result.archive.content).toContain("ClinicalTrials.gov search: AREA[Condition] Aspirin");
    expect(result.archive.content).toContain("Status: completed");
    expect(result.archive.content).toContain("NCT03827343");
    const archived = await readFile(path.join(sessionDir, result.studyArchives[0]!.path), "utf8");
    expect(archived).toContain("# Aspirin for primary prevention in high-risk adults");
    expect(archived).toContain("Overall status: RECRUITING");
    expect(archived).toContain("- Cardiovascular Diseases");
    expect(mock.urls[0]).toContain("clinicaltrials.gov/api/v2/studies");
    expect(mock.urls[0]).toContain("query.term=");
  });

  it("reads a full study protocol by NCT ID", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-clinicaltrials-"));
    const mock = mockFetch([Response.json(aspiritStudy)]);

    const result = await readClinicalTrial({ sessionDir, nctId: "nct03827343", fetcher: mock.fetcher });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nctId).toBe("NCT03827343");
    expect(result.archive.sourceUrl).toBe("https://clinicaltrials.gov/study/NCT03827343");
    expect(result.archive.content).toContain("# Aspirin for primary prevention in high-risk adults");
    expect(result.archive.content).toContain("## Design");
    expect(result.archive.content).toContain("- Study type: INTERVENTIONAL");
    expect(result.archive.content).toContain("Enrollment: 2000 (ANTICIPATED)");
    expect(result.archive.content).toContain("## Primary outcomes");
    expect(result.archive.content).toContain("Major adverse cardiovascular events");
    expect(result.archive.content).toContain("## Eligibility");
    expect(result.archive.content).toContain("Ages 50-70 years with elevated cardiovascular risk.");
    expect(mock.urls[0]).toContain("/api/v2/studies/NCT03827343");
  });

  it("returns identifier_not_found for missing studies", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-clinicaltrials-"));
    const mock = mockFetch([new Response("not found", { status: 404 })]);
    const result = await readClinicalTrial({ sessionDir, nctId: "NCT00000000", fetcher: mock.fetcher });
    expect(result).toMatchObject({ ok: false, error: { code: "identifier_not_found" } });
  });

  it("rejects malformed NCT identifiers without a request", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-clinicaltrials-"));
    const result = await readClinicalTrial({ sessionDir, nctId: "not-an-id", fetcher: mockFetch([]).fetcher });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("returns structured errors on failed searches", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "ebm-clinicaltrials-"));
    const mock = mockFetch([new Response("rate limited", { status: 429 })]);
    const result = await searchClinicalTrials({ sessionDir, query: "aspirin", fetcher: mock.fetcher, retries: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: "clinicaltrials_request_failed", status: 429 } });
  });
});