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
2. Search and read sources.
3. Archive sources.
4. Add exact-quote Markdown evidence records.
5. Read evidence records again before drafting citations that point to evidence IDs.
6. Verify all claims before final answer.
