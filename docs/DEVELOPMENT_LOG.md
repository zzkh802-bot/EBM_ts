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

### Completed slice: Pi evidence extension and provider/runtime validation

- Registered `evidence_add`, `evidence_list`, and `evidence_read` as project-local Pi tools.
- Tool writes are serialized with Pi's `withFileMutationQueue`; successful writes emit `ebm:evidence_added`.
- Added a real Pi resource-loader test plus tool execution/event test.
- Switched the default to Pi native `deepseek/deepseek-v4-flash`; removed the redundant custom official provider.
- Kept Xinqiong as an OpenAI-compatible endpoint using the existing `OPENAI_API_KEY`.
- Real calls verified DeepSeek thinking off/on and tool calls, plus Xinqiong thinking/tool calls.
- Added `npm run ebm` and a simple timeout-bounded `npm run test:network` diagnostic.
- Verification: `npm run check` — 7 files, 14 tests passed.

### Basic-refactor milestone

Continue through archived web read/search, PubMed, guideline MCP, and verified Markdown report writing before optional polish. See `docs/CURRENT_STATE.md` for the executable milestone boundary.

### Completed slice: archived web read/search

- Added Jina-first `web_read` with Firecrawl scrape fallback and structured per-provider failures.
- Added Tavily `web_search`; only result content is model-visible/archived, never quota or response telemetry.
- Both tools normalize and archive output before exposure and emit `ebm:source_archived`.
- Archive records now expose the absolute body line offset so evidence ranges match frontmatter-bearing files.
- Tool output is bounded while the complete normalized source remains archived; large source content is excluded from Pi result details.
- Real proxy-environment checks passed: Jina archived NCBI (8,973 chars); Tavily archived two results.
- Verification: `npm run check` — 8 files, 17 tests passed.

### Active slice

- Implement `pubmed_search` and `pubmed_read` against NCBI E-utilities with archived records.
