---
name: ebm-research
description: Evidence-Based Medicine research workflow. Use when answering clinical questions, building PICO, searching biomedical literature/guidelines, extracting exact evidence quotes, or drafting EBM reports.
---

# EBM Research

## Rules

1. Frame the question as PICO when possible.
2. Prefer guidelines, systematic reviews, RCTs, then observational/regulatory/background sources.
3. Archive source material before using it as evidence.
4. Add evidence only from exact source quotes with stable line offsets using `evidence_add`.
5. Report uncertainty and evidence gaps explicitly.
6. Do not invent citations or guideline recommendations.
7. Optimize for the clinical information need, not possession of one specific document.
8. Treat ordinary web-search snippets and unverified mirrors as discovery only.

## Guideline acquisition ladder

Use bounded escalation rather than repeatedly pursuing one unavailable guideline:

1. Try the issuing body, journal, guideline MCP, or other official full text.
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

## Minimal workflow

1. State the research question and PICO.
2. Use `pubmed_search` to review batched abstracts; similar-article hints are discovery only, not evidence.
3. Use `pubmed_read` only for selected records whose full text could change the decision; it reports whether PMC full text was obtained.
4. Search/read outputs are already archived before exposure.
5. Add exact-quote Markdown evidence records early when an abstract or full-text passage is decision-relevant.
6. Read evidence records again before drafting citations that point to evidence IDs.
7. Verify all claims before final answer.
