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

## Minimal workflow

1. State the research question and PICO.
2. Use `pubmed_search` to review batched abstracts; similar-article hints are discovery only, not evidence.
3. Use `pubmed_read` only for selected records whose full text could change the decision; it reports whether PMC full text was obtained.
4. Search/read outputs are already archived before exposure.
5. Add exact-quote Markdown evidence records early when an abstract or full-text passage is decision-relevant.
6. Read evidence records again before drafting citations that point to evidence IDs.
7. Verify all claims before final answer.
