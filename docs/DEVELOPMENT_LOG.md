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

### Completed slice: PubMed search/read

- Added `pubmed_search` using ESearch + ESummary and `pubmed_read` using EFetch XML.
- PMID, PMCID, and DOI resolution paths are supported; records are normalized and archived before exposure.
- NCBI `tool`, `email`, and `api_key` parameters follow official E-utilities guidance; secrets never enter archives.
- Added bounded retries for connection errors, HTTP 429, and 5xx responses with explicit terminal errors.
- Diagnosed local Node/NCBI dual-stack failure: curl IPv4 and an Undici IPv4 dispatcher succeeded while default fetch timed out. NCBI calls now use direct IPv4 and do not require a proxy.
- Real checks passed for search and abstract read with `NCBI_EMAIL` and `NCBI_API_KEY` configured.
- Verification: `npm run check` — 9 files, 21 tests passed.

### Completed slice: verified Markdown reports

- Added `report_write` and core `writeReport()`.
- Report evidence IDs are extracted from Markdown, loaded from Markdown evidence records, and reverified against archived source slices before write.
- Unknown, stale, hash-mismatched, or citation-ineligible evidence blocks report generation.
- Evidence-free reports require explicit `allow_no_evidence` and are marked as evidence gaps.
- Reports are normalized Markdown with deterministic content hashes and evidence metadata.
- Verification: `npm run check` — 10 files, 24 tests passed.

### Completed slice: internal guideline MCP

- Added a lean Streamable HTTP JSON-RPC client without importing a heavyweight MCP runtime.
- Initialization, negotiated session headers, JSON and SSE responses, tool errors, malformed JSON, HTTP failures, and hard timeouts are explicit.
- Calls are serialized because the internal server is not assumed parallel-safe.
- `guideline_mcp_search` and `guideline_mcp_read` archive normalized output before model exposure.
- Real internal-server checks passed for search and read (`max_chars=3000`).
- Verification: `npm run check` — 11 files, 27 tests passed.

### Completed slice: MinerU document reading

- `web_read` detects PDF/Office/e-book URL suffixes and tries MinerU Premium before web readers.
- Premium URL tasks are created, polled with hard timeouts, downloaded as ZIP, and reduced to normalized Markdown.
- Task failure, HTTP failure, missing result URL, malformed ZIP, empty Markdown, and polling timeout are explicit; Jina/Firecrawl remain fallbacks.
- Real MinerU Premium demo PDF check passed (51,291 Markdown characters).
- Verification: `npm run check` — 12 files, 30 tests passed.

### Completed slice: writing skill and basic vertical acceptance

- Migrated `clinical_report_writing` to the project-local Pi skill format as `clinical-report-writing`.
- Adapted obsolete Python tool references to Pi `read`, immutable replacement evidence, and explicit `ev_...` report references.
- Pi's resource loader verifies both project skills without diagnostics.
- Added a vertical acceptance test: archived discovery → exact absolute-offset evidence → source revalidation → verified Markdown report.
- Verification: `npm run check` — 13 files, 31 tests passed.

### Basic-refactor milestone complete

The target in `docs/CURRENT_STATE.md` is satisfied. Further work is hardening rather than foundation completion: DNS/redirect SSRF protection, MinerU local upload fallback, PMC full text, and broader end-to-end evaluation.

### Completed hardening: Pi compaction artifacts

- Added a passive `session_compact` event consumer; Pi still creates and applies its native summary.
- The completed summary and lineage metadata are atomically mirrored to `data/sessions/{id}/compactions/{entryId}.json`.
- The artifact includes reason, retry state, first kept entry, token count, source (Pi/extension), and summary.
- Verification: `npm run check` — 14 files, 32 tests passed.

### Completed hardening: PubMed abstracts and PMC full text

- `pubmed_search` now batches EFetch so the first search call returns archived PubMed abstracts, avoiding one model round per abstract.
- Optional ELink similar-article discovery returns bounded PMID/title hints clearly labeled as unread discovery records.
- `pubmed_read` now means full-text acquisition: it resolves PMID/PMCID/DOI, detects PMCID, fetches PMC JATS XML, and archives readable full text.
- Records without usable PMC full text return an explicit `fullText: false` abstract-only result and warning rather than pretending full-text success.
- Real checks passed: 3 search results with 3 abstracts and 3 related hints; PMC full text for PMID 33884067 archived successfully.

### Completed hardening: bounded OA recovery and indirect guideline evidence

- Added a five-second OpenAlex resolver for direct OA PDF locations when PMC text is unavailable.
- OA PDFs are locally downloaded with a 25-second default timeout, 50 MB cap, manual redirect handling, and public-DNS validation at every hop.
- Added MinerU Premium signed-upload support so foreign OA files can be downloaded locally and uploaded instead of relying on MinerU to fetch blocked foreign URLs.
- Real end-to-end fallback succeeded for PMID 36780904: OpenAlex discovery → repository PDF → local download → MinerU upload → 53,742-character archive. Total wall time was about 96 seconds, but it remained one model tool round.
- A Wiley OA endpoint returned HTTP 403 in about 3.5 seconds and correctly degraded to an explicit abstract-only result rather than retrying additional locations.
- Added evidence provenance classes. `discovery_only` and `guideline_mirror_unverified` records are not citation eligible.
- Added a bounded guideline acquisition ladder: official source → verified mirror → attributed secondary source → independent guideline addressing the same clinical question.

### Completed usability: semantic artifact names

- Replaced hash-based source and report filenames with Unicode-preserving names derived from title, query, URL, or first readable heading.
- Identical artifacts reuse the same path; different content with the same semantic name receives `-2`, `-3`, and so on without overwriting earlier evidence lineage.
- SHA-256 remains in frontmatter and verification metadata, not in model-facing filenames.
- Kept evidence IDs unchanged as stable report references; `EVIDENCE.md` provides their claim semantics.
- Confirmed the lean policy: no separate user-upload workflow, no further document-chain abstraction, and PubMed abstracts remain valid evidence within their explicit scope.

### Completed observability: Pi-native developer trajectories

- Reviewed Pi extension, SDK, JSON event stream, RPC, session-format, and compaction interfaces. Pi already exposes finalized assistant thinking blocks, message/turn lifecycle, tool start/end, provider request/response, model/thinking changes, compaction, and session shutdown.
- Added a project-local trajectory recorder through Pi extension hooks; no Pi vendor modification or AgentLoop replacement was needed.
- Developer-only logs are written incrementally to `data/sessions/{sessionId}/trace/trajectory.md` and `trajectory.jsonl`; neither file is appended to the Pi session or model context.
- Markdown provides a readable run/turn/thinking/tool chronology. JSONL uses a versioned normalized event record for downstream model analysis and eval.
- Large tool strings are bounded while finalized thinking is preserved; obvious secret-bearing fields are redacted and files use owner-only permissions.
- Added `npm run trace:analyze` to calculate turns, tool failures and latency, repeated tool actions, time/turn to first `evidence_add`, full-text versus abstract-only reads, provider errors, compactions, thinking/response volume, and token/cache usage.
