---
name: ebm-research
description: Evidence-Based Medicine research workflow. Use when answering clinical questions, building PICO, searching biomedical literature/guidelines, extracting exact evidence quotes, or drafting EBM reports.
---

# EBM Research

## Rules

1. Frame the question as PICO when possible, but do not stop at PICO. Convert the user's broad query into the smallest set of decision-changing EBM sub-questions, then into claim-level evidence needs. When the user names specific outcomes (for example DFS, OS, recurrence, severe adverse events), preserve them as evidence concerns inside the relevant sub-questions rather than forcing a table or one-section-per-outcome structure.
2. Prefer authoritative clinical practice guidelines, systematic reviews, RCTs, then observational/regulatory/background sources. Do not treat expert consensus as equivalent to an authoritative guideline: in Chinese clinical contexts, national/official society guidelines usually carry much more decision weight than expert consensus documents, which may reflect opinion or local practice and may not be independently validated.
3. Archive source material before using it as evidence.
4. Add evidence only from exact source quotes with stable line offsets using `evidence_add`. Treat evidence records as claim-linked evidence candidates, not final conclusions: use `confidence=low` or `moderate` when directness or interpretation is still uncertain, and reserve `high` for directly applicable, clearly interpreted evidence. For PubMed abstracts, copy the exact `Read exact abstract` offset/limit returned by `pubmed_search`; do not widen it by estimation or use shell commands to count lines.
5. Report uncertainty and evidence gaps explicitly.
6. Do not invent citations or guideline recommendations. Final report body citations must be numbered (`[1]`, `[2]`), not raw evidence IDs; raw `ev_...` IDs should be passed through `report_write.references` for hidden verification and should not appear in the user-facing Markdown.
7. Optimize for the clinical information need, not possession of one specific document.
8. Treat ordinary web-search snippets and unverified mirrors as discovery only.
9. Preserve the user's exact comparator. Evidence comparing HDAC with SDAC, for example, is indirect for a question comparing HDAC monotherapy with standard-dose multi-agent consolidation and cannot establish the requested ranking.
10. Track access to a named study by evidence level rather than calling it simply “unavailable”: `full_text`, `abstract_only`, `identifier_only`, or `not_found`. A complete PubMed abstract means `abstract_only`, not unavailable, and may already be sufficient. Use at most two targeted discovery attempts for the same named study: first an exact PMID/DOI/title lookup; second only when it uses a genuinely new identifier or route (for example PMC, publisher, repository, or OA PDF). A paraphrased query is not a new route. After explicit `abstract_only`, no-OA, reader failure, or two exact no-match outcomes, record the reachable level and pivot unless fuller text could materially change the decision. For PubMed specifically, do not use long natural-language comparator sentences as repeated queries; use a ladder: PMID/DOI → exact title phrase → first author + distinctive title words → short disease + intervention + study type query. PubMed queries should be compact keyword combinations, usually 3-7 meaningful terms plus at most one field/study-type filter; avoid stuffing every PICO element into one query.

## Evidence authority and consensus handling

Rank sources by both evidence type and issuing authority. For Chinese clinical questions, distinguish at least:

1. Authoritative clinical practice guideline: national commission/official specialty society guideline, formal guideline methods, explicit recommendations, evidence grading, update/version date. This can establish standard practice when applicable.
2. International or foreign authoritative guideline: strong source, but check local applicability, drug availability, thresholds, population, and whether Chinese guidance differs.
3. Systematic review/meta-analysis or pivotal RCT: strong for efficacy/safety claims, especially when newer than the guideline or when it could update the guideline frame.
4. Expert consensus/position statement: useful for practical framing, rare situations, or areas without formal guidelines, but lower authority than a guideline. Treat as consensus-level support, not validated guideline evidence, unless it explicitly reports formal methodology and evidence grading.
5. Narrative review, educational article, webpage, or local protocol: background/discovery unless read and directly traceable; do not let it override guidelines or primary evidence.

When a source says “专家共识”, “共识意见”, “position statement”, or similar, do not cite it as “指南” and do not let it carry the same force as an official guideline. If only consensus evidence exists, say so explicitly and lower confidence or mark the conclusion as conditional. If a consensus conflicts with an authoritative guideline, prefer the guideline unless newer primary evidence explains the divergence.

## Clinical cognition before search

Before choosing tools, classify the clinical role of the user's question. This is medical know-how, not a formal label:

- Eligibility/contraindication question: first find authoritative thresholds, exclusion criteria, and what other conditions must still be checked. A single condition being acceptable does not mean the whole intervention is approved.
- Treatment choice question: identify the competing options, patient subgroup, benefit outcomes, harm outcomes, and what result would change the ranking. If the user names outcomes, make sure the synthesis explains how those outcomes jointly affect the treatment choice; do not turn the report into a mechanical outcome table unless requested.
- Guideline implementation question: distinguish mandatory boundary, preferred option, optional recommendation, monitoring rule, and low-evidence practice suggestion.
- Diagnostic/prognostic question: identify reference standard, target condition, population, time horizon, and whether the result changes management.
- Evidence freshness question: use guidelines for the decision frame, then search only for recent evidence that could plausibly update or overturn that frame.

Use this clinical role to decide whether MCP, PubMed, web, or source reading comes first. The goal is not to collect more documents; it is to reduce the uncertainty that changes the clinical answer.

## Query language and construction

Choose query language by source and task rather than mirroring the user mechanically:

- `source_library_search`: before any broad external `web_search`, and before repeated PubMed discovery attempts for a named study/topic, search the local library first. Use Chinese queries for Chinese guideline/library content and compact English queries for PubMed-like/library article content. If it returns a relevant `source_url`, call `web_read(url=...)`; this is usually a local-library read and avoids external search/parse latency.
- `guideline_mcp_*`: use the language most likely to match the local guideline corpus and clinical scenario. For Chinese clinical guideline questions or Chinese guideline retrieval, use Chinese terms first, including Chinese disease/intervention names. For international guideline or English-source retrieval, use English. If MCP search returns sparse, noisy, or off-topic results, use `source_library_search` to check curated local guidelines/full texts before broad web search.
- `pubmed_search`: prefer English. Use short keyword combinations, not prose. Good forms are `disease intervention study-type`, `first-author exact-title-phrase`, or `drug disease outcome`. Use field tags only when they sharpen the search, for example `[tiab]`, `[pt]`, exact quoted title fragments, or PMID/DOI. Do not combine too many synonyms, comparators, outcomes, and filters in a single query; if needed, run one broad query and one targeted query rather than one overloaded query.
- `web_search`: use advanced search tactics when helpful: exact quotes for titles, organization/year terms for guidelines, site/domain hints such as `site:pmc.ncbi.nlm.nih.gov` or `site:nccn.org`, file/type hints such as `PDF` when seeking documents, and Chinese queries for Chinese society/journal pages. Web snippets remain discovery only until the underlying source is read.

A useful default ladder for a named paper is: PMID/DOI → exact title phrase → first author + distinctive title words → short disease + intervention + study type. For a guideline: organization + disease + year/version + key recommendation term, in the source language.

## MCP-first cognition, then freshness correction

For guideline-answerable clinical questions, use guideline MCP as the first cognition source, not necessarily the final or only evidence source. MCP should quickly establish the decision frame: candidate recommendations, thresholds, contraindications, PICO terms, claim boundaries, and likely evidence gaps.

Use this default sequence:

1. Start with `source_library_search` plus `guideline_mcp_search`/`guideline_mcp_retrieve` to identify the local guideline/article frame and 1-3 decision-changing claims. If local library hits already include directly relevant guideline/review/RCT records, read those local hits before external search.
2. If MCP returns traceable, official or clearly verified, recent-enough chunks that directly answer the claim, add them as evidence early.
3. If the guideline is older than about 3 years, the topic is fast-moving, the recommendation is controversial, or the MCP result only gives an indirect/secondary view, treat MCP as preliminary cognition and run targeted PubMed/Web update searches for only the claims that could change the answer.
4. Do not run broad PubMed searches before MCP for ordinary clinical recommendation questions unless the question is not guideline-answerable, concerns a named trial/article, asks for newest studies, or MCP is unavailable.
5. In the final report, separate source roles in user-facing language: authoritative guidelines establish current standards and boundaries; primary studies and systematic reviews update, support, or challenge that standard; ordinary web/search snippets are discovery only unless the underlying source has been read and is citable. Do not mention internal acquisition routes such as MCP, PubMed tool calls, RAG chunks, archive paths, or evidence IDs in the report body.

## Guideline acquisition ladder

Use bounded escalation rather than repeatedly pursuing one unavailable guideline:

1. If guideline MCP tools are available, use `guideline_mcp_search` or `guideline_mcp_retrieve` early for clinical recommendation questions to establish the decision frame. Use `guideline_mcp_retrieve` for focused traceable chunks; when a returned chunk directly supports a claim, use its readable chunk path and exact lines with `evidence_add` without reading the full document. Use `guideline_mcp_read` only when broader context, date/version, applicability, or conflict resolution is needed. If MCP search is sparse/noisy or a known local guideline may already be curated, use `source_library_search` before broad web search; when it returns a source URL, call `web_read(url=...)` to archive the local library copy into the current session.
2. Search the exact title, organization, year, and file type for a mirror.
3. Treat a mirror as verified only when title, issuer, version/year, pagination, and recommendation structure match authoritative metadata or an independent copy.
4. If direct text remains unavailable, use credible reviews, HTA/implementation documents, or later guidelines that quote or characterize the target.
5. For a clinical decision question, pivot to independent guidelines and primary studies addressing the same question.
6. Stop pursuing the target after bounded direct attempts unless its exact wording or recommendation grade could change the answer.

Preserve attribution boundaries:

- Official or verified mirrored text may support a direct statement about the guideline.
- A secondary direct quote supports “Source X quotes Guideline Y as stating …”.
- A secondary paraphrase supports only “Source X characterizes Guideline Y as …”.
- An independent guideline supports the clinical conclusion independently; it does not recover the unavailable target guideline.
- If the user asks for an exact recommendation or grade, indirect evidence is insufficient and the missing primary text must be disclosed.

## Research state behavior

For non-trivial EBM questions, the research frame is a decision aid, not a paperwork task. Use it only when it improves the next action, prevents drift, or records a belief change that will affect the report. Do not update the frame merely to satisfy a checklist.

Good state updates are short and action-oriented:

- After MCP gives useful cognition, record only the working belief that changes retrieval strategy: what the guideline seems to say, how authoritative/fresh it is, and whether a targeted PubMed/Web freshness check is still needed.
- After `evidence_add`, update state only if the evidence changes a claim, narrows applicability, reveals conflict, or justifies stopping retrieval.
- Before PubMed/Web after MCP, know the claim-level reason for the update search. If the reason is only “more literature might exist,” do not search broadly.
- Before `report_write`, you do not need a polished frame. You only need enough internal state to map final claims to numbered references and to distinguish source authority levels such as authoritative guideline, expert consensus, and primary study.

Prefer `research_frame_scratchpad_append` over full frame rewrites for lightweight observation → belief → next-action notes. If frame tools are disabled or the state is already obvious, proceed without blocking the answer.

## Minimal workflow

1. Choose frame timing by complexity. For complex, multi-claim, outcome-rich, or comparator-heavy EBM questions, call `research_frame_init` early to create the working canvas before broad retrieval. The frame should preserve the user's named outcomes as evidence concerns within clinically meaningful sub-questions, and distinguish direct from indirect evidence without forcing a table-shaped report. For narrow guideline-answerable questions such as thresholds, contraindications, eligibility, dosing boundaries, or monitoring rules, MCP may come first to acquire cognition; then initialize or append state only if it improves the next action, stop decision, or report mapping. In either path, state the overall clinical decision, decompose only into decision-changing sub-questions, and avoid building the report around tool calls or source lists. If research frame tools are disabled or unavailable, fall back to doing the same structure mentally and continue.
2. For guideline-answerable clinical recommendation questions, use MCP before broad biomedical search. Prefer `guideline_mcp_retrieve` for focused chunks; if you need document identity, date, recommendation context, or applicability boundaries, use `guideline_mcp_search`/`guideline_mcp_read`. After the first useful MCP result, use `research_frame_scratchpad_append` only if the MCP result changes the retrieval strategy, exposes a freshness gap, or creates a clear stop condition. If 1-2 traceable chunks directly answer a sub-question, add evidence from those chunk paths and stop expanding that sub-question unless there is conflict, missing context, old guidance, or a fast-moving topic.
3. Use `pubmed_search` as targeted freshness correction or primary-study retrieval, not as default broad exploration after MCP/local-library hits have already answered the claim. Before `pubmed_search`, try `source_library_search` with compact English title/PMID/topic terms; if a relevant local PubMed/PMC-like hit exists, use `web_read` on its `source_url` instead of searching PubMed again. Search PubMed only for the specific claim that could change the conclusion, such as a recent RCT, systematic review, safety signal, guideline update, or named study. Each complete PubMed abstract is archived separately under the returned readable abstract path and automatically upserted into the local source library; use that path and the exact abstract lines with provenance `primary_abstract` for claims explicitly stated in the abstract. The `sources/search/` snapshot is discovery only, not evidence. If a PubMed query returns no PMID, do not keep rephrasing the same long comparison. Retry once with a shorter structurally different query: PMID/DOI if known; exact title phrase if known; first author plus distinctive title words; or disease + intervention + study type. Then pivot.
4. Use `pubmed_similar` only when one relevant PMID should seed retrieval expansion; review the top similar titles/abstract previews, then use `pubmed_read` or the returned abstract source paths only when they are decision-relevant.
5. Use `pubmed_read` only for selected records whose full text could change the decision; it reports whether PMC full text was obtained.
6. Search/read outputs are already archived before exposure.
7. Add exact-quote Markdown evidence records as soon as an abstract, full-text passage, or traceable MCP RAG chunk becomes decision-relevant; do not postpone all `evidence_add` calls until the end of retrieval just because interpretation is preliminary. After adding evidence, update the frame only when it changes a claim, source authority judgment, applicability boundary, next action, or stop condition; use `research_frame_scratchpad_append` for short observation → belief → next-action notes when useful. Use `low`/`moderate` confidence for early or indirect evidence and revise the final synthesis by weighing the evidence inventory. Avoid duplicate records for overlapping windows from the same source unless they support genuinely different claims.
8. Do not call `evidence_read` immediately after a successful `evidence_add` merely to verify it; `report_write` mechanically verifies referenced evidence. Use `evidence_list` for the evidence inventory and call `evidence_read` only when the exact quote/details are needed for writing or resolving conflict.
9. Before stopping retrieval, check whether at least one source directly matches the population, intervention, comparator, and outcome requested. If not, state that the direct comparison is insufficient; do not let a larger body of indirect evidence silently replace it.
10. Before `report_write`, create an internal citation map from evidence IDs to numbered real references. In the report body and reference list, cite as `[1]`, `[2]` with real source text; pass the raw evidence IDs only through `report_write.references`.
11. Verify all claims before final answer.
