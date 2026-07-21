# Development Log

Persistent implementation memory for context compaction/recovery. Update after each verified vertical slice.

## Current direction

- Pi-first: use Pi SDK/extensions/events/TUI; do not rebuild agent runtime.
- Async-first EBM tools.
- Markdown source/evidence truth with stable line offsets.
- Local development first; Pi native TUI and bash remain available.
- Governing decisions: `docs/adr/0001-*`, `0002-*`, `0003-*`.

## 2026-07-21 — implementation started

### Planned order

1. Deterministic Markdown normalization before archive/model visibility.
2. Markdown-first evidence records and indexes.
3. Pi extension tools for web read/search with archive.
4. PDF/MinerU Premium flow and Firecrawl fallback.
5. PubMed search/read.
6. Guideline MCP.
7. Writing skills and TUI launcher/integration tests.

### Completed slice: deterministic Markdown normalization

- Added public `normalizeMarkdown()` with deterministic prose wrapping and CRLF normalization.
- Fenced code blocks and Markdown table rows remain unchanged.
- `archiveSource()` now normalizes before naming, hashing, writing, and returning model-visible content.
- Archive record exposes normalized `content` and `lines`; these are the exact archived body/line semantics.
- Fixed source frontmatter separator to include a real blank line before body.
- TDD evidence: initial missing-module failure, table-row failure, archive/model-visible mismatch failure, then green.
- Verification: `npm run check` — 6 files, 10 tests passed.

### Completed slice: Markdown-first evidence persistence

- `addEvidence()` now writes `evidence/{id}.md`, not JSON-only records.
- Evidence frontmatter includes stable id, question, claim, relation, source path/range/read hint, hash, status, and citation eligibility.
- Body contains readable claim relation and one exact quote fence; no redundant raw JSON body.
- `evidence/EVIDENCE.md` is maintained as an agent-readable index.
- Evidence source resolution rejects `..` and symlinks escaping the session directory.
- TDD evidence: missing `.md`, missing index, and symlink escape tests each failed before implementation.
- Verification: `npm run check` — 6 files, 11 tests passed.

### Completed slice: evidence read/list interfaces

- Added `readEvidence(sessionDir, id)` with frontmatter/exact-quote parsing, filename/id consistency check, and source verification.
- Added deterministic `listEvidence(sessionDir)` summaries for Pi tools/UI.
- Malformed evidence is an explicit error rather than silently skipped.
- TDD evidence: public list/read test failed before implementation.
- Verification: `npm run check` — 6 files, 12 tests passed.

### Active slice

- Expose archive/evidence functionality through project-local Pi extension tools, preserving Pi's event/runtime model.

### Verification baseline

- `npm run check`: 5 test files, 7 tests passing before implementation.
