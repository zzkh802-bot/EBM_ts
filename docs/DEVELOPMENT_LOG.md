# Development Log

Persistent implementation memory for context compaction/recovery. Update after each verified vertical slice.

## Current direction

- Pi-first: use Pi SDK/extensions/events/TUI; do not rebuild agent runtime.
- Async-first EBM tools.
- Markdown source/evidence truth with stable line offsets.
- Local development first; Pi native TUI and bash remain available.
- Governing decisions: `docs/adr/0001-*`, `0002-*`, `0003-*`.

## 2026-07-30 — product runtime and execution visibility

### Completed slice: model configuration and user-visible execution

- Made the TypeScript research service the only user-facing chat path. The retired Python/V1 route remains a compatibility API only; the UI no longer asks users to choose an implementation backend.
- Added `GET /api/v1/runtime-config`. It returns only provider/model labels, availability and setup hints—never credentials. The submit request now carries the selected provider/model and the server validates it against this configuration before launching the runtime.
- Added server configuration for 芯穹, DeepSeek, OpenAI and Anthropic. 芯穹 now prefers `XINQIONG_API_KEY` while retaining the existing `OPENAI_API_KEY` compatibility path; OpenAI requires the explicit `EBM_ENABLE_OPENAI=1` guard to avoid mistaking a legacy 芯穹 key for an OpenAI key.
- Reused the runtime's native tool lifecycle: a tool starts one record and completion updates that same record. The frontend polls and renders each call as one compact line; users can expand it for input, result summary, error and timestamps. Tool output is bounded and obvious secret-shaped values are redacted before it crosses the API boundary.
- Removed demo-like static “connected sources”, fabricated daily counts and fabricated continuation cards. The side panel now reflects real server configuration and the selected research mode.
- Kept the runtime implementation private in product text: user-visible copy refers to the “循证研究服务” and “研究引擎”; runtime names remain limited to internal code/ADR documentation.
- Deliberately did not add a per-tool approval/rollback workflow: clinical research involves many read-only actions, so it would add friction without a meaningful decision boundary.
- Verification: root `npm run typecheck`; focused `npm test -- tests/agentApi.test.ts` (5 passing); frontend `npm run typecheck && npm test` (20 passing).

### Completed slice: subscription account connection

- Studied the runtime TUI account flow and reused its `ModelRuntime.login()` interface instead of reimplementing provider OAuth. The runtime supports ChatGPT Plus/Pro (Codex) and Claude Pro/Max subscription login, alongside API-key deployment configuration.
- Added local single-user account-connection endpoints. They relay only an authorization URL, device code, non-secret selection/manual-code prompt and status; credentials remain in the service-owned credential store and never enter an API response or frontend state.
- Runtime configuration now reevaluates subscription availability after a connection, making the corresponding model selectable without exposing provider/runtime internals.

### Sweep cleanup: inactive frontend paths

- Removed four unreferenced duplicate evidence components: an old composer, conversation feed, message renderer and debug panel. The active Evidence page is now the single owner of the chat/composer/rendering path.
- Removed the visible but inert voice-input control rather than advertising a feature with no implementation.
- Pointed the shell health state at the active research service instead of the retired Python proxy. Replaced fabricated recent sessions and demo-user authentication text with live browser-session data and truthful local-workspace copy; removed the inert global share button.
- Removed four unimported legacy stylesheet files after confirming `styles/index.css` is the sole stylesheet entry point. Production build remains unchanged in size and succeeds.

### Completed slice: unified local product delivery

- Kept Vue/Vite for productive development, but added one production launch path: `npm start` builds the frontend and the Node research service hosts the resulting files and APIs from the same origin.
- The service recognizes the existing `/ts-api` development prefix, so the frontend keeps one API contract in development and production. Unknown API routes remain JSON 404s; only ordinary browser routes receive the SPA fallback.
- Rebranded the browser document title and metadata as 循医. No implementation/runtime name is exposed in product-facing copy.
- Preserved the existing blue-green palette. Tightened the clinical-workspace hierarchy around the question composer, evidence-run details, side-panel status and keyboard focus without changing the product's visual language.
- Account-connection failures now expose a concise recovery message instead of a runtime exception. Credentials and account-store data remain server-owned.
- Verification: root typecheck and boundary check; frontend typecheck and production build; live same-origin checks for `/`, `/evidence`, `/ts-api/health`, and an unknown API route (404 JSON).

### Completed slice: research-mode and conversation ergonomics

- Reframed the user-facing research choices as 快速 and 专家 while retaining the `instant` / `expert` API values. The composer now states what the selected mode changes; switching modes also gives deep thinking a coherent default, which remains user-adjustable.
- Made the primary action truthful while a run is active: an empty composer stops the current research run; typed text becomes a queued follow-up and the button changes accordingly.
- Selecting a clinical example fills and focuses the composer. Assistant messages retain the mode and audience used for that specific answer, so a mixed-mode conversation stays legible.
- Reduced report-action noise: follow-up, concise conclusion and expanded evidence remain visible; copy, speech, sharing, rerun, Markdown and archive actions live under one “更多” menu.
- Captured the real local product page with host Chrome in headless mode and used the review to remove generic/internal English labels, clarify example usage, and prevent provider labels from wrapping character-by-character.
- Verification: frontend typecheck, production build, frontend test suite (20 passing), root boundary check, and visual screenshots at 1440px.

### Completed slice: trustworthy research-process visibility

- Used a real non-patient clinical query to inspect the live task event stream, then cancelled it once the display path was verified to avoid unnecessary provider usage.
- Fixed the API run store so a tool start and its completion, which share a call ID, update one record instead of creating duplicate rows. Added a focused regression assertion for that lifecycle merge.
- Classified startup reads of project research rules as a concise preparation step. Their path and full internal content no longer enter the user-visible tool detail panel.
- The frontend now translates common evidence operations into plain-language steps (for example searching literature, reading guidelines, recording evidence, and drafting the final report). The full visible tool result remains available on expansion for research work itself.
- Server-reported state now wins over time-based fallback labels for a short freshness window. The pending status therefore tracks actual retrieval, active tool work, report drafting, cancellation, and network recovery instead of only elapsed time.
- Verification: root typecheck; focused API test suite (5 passing); frontend typecheck and production build; restarted local service and confirmed health endpoint.

### Completed slice: single-service navigation and mobile research flow

- Removed the visible entry points for legacy knowledge and literature pages because their requests still require the retired service. Old bookmarks now return to the evidence workspace instead of exposing a broken screen; the active navigation is limited to evidence work, research records, and creating a new research session.
- Updated desktop, drawer and mobile vocabulary from “问诊/历史” to “研究记录”, matching the product’s evidence-workflow role.
- Reworked the mobile composer into a vertical five-step layout: mode, mode explanation, clinical question, provider/retrieval choices, and an explicit primary action. This prevents desktop control geometry from forcing horizontal overflow on narrow screens.
- Rebuilt the mobile bottom navigation as three equal actions: records, evidence workspace, and new research.
- Verification: frontend typecheck/build/test suite, boundary check, old-route SPA fallback, and visual review at desktop plus 500px mobile layout.

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
- Developer-only logs are written incrementally to `data/sessions/{workspace}/trace/trajectory.md` and `trajectory.jsonl`; the full Pi UUID is retained in trajectory metadata, and neither file is appended to the Pi session or model context.
- Markdown provides a readable run/turn/thinking/tool chronology. JSONL uses a versioned normalized event record for downstream model analysis and eval.
- Large tool strings are bounded while finalized thinking is preserved; obvious secret-bearing fields are redacted and files use owner-only permissions.
- Added `npm run trace:analyze` to calculate turns, tool failures and latency, repeated tool actions, time/turn to first `evidence_add`, full-text versus abstract-only reads, provider errors, compactions, thinking/response volume, and token/cache usage.
- Added explicit second-level wall-clock fields for the full run, each turn, provider headers, first thinking/text/tool-call delta, complete model message, and each tool invocation.
- Hardened trace redaction for embedded Authorization/OAuth/API-key/cookie/Lark webhook text as well as structured secret fields. Pi native session JSONL can still retain text already exposed to the model, so diagnostics must never print credentials.

### First measured real E2E baseline

- Kept Pi's generated system prompt, dynamic tools, guidelines, context, and skills. A small `before_agent_start` extension changes only the opening coding-agent identity to an evidence-based-medicine agent identity.
- Removed the legacy mandatory `research_frame.md` sections from the clinical writing skill and aligned it with the mechanical rule that ordinary web-search snippets are discovery-only while explicit PubMed abstract claims remain eligible.
- Ran the acute ischemic stroke/alteplase example with DeepSeek V4 Flash and high thinking. It completed successfully, registered eight evidence records, and wrote a verified Chinese report.
- Independent wall time was 164.51 seconds; trajectory time was 163.001 seconds. The run used 33 turns and 52 tool calls, reached first evidence at turn 17 / 85.72 seconds, and had no provider HTTP errors.
- The trajectory exposed a concrete locality defect rather than a belief-state defect: archive output told the model to use Pi `read` with a session-relative `sources/...` path, but built-in `read` resolves from the workspace root. The model spent repeated `bash/find/grep` calls locating files and initially supplied two invalid evidence ranges.
- Archive output now emphasizes the workspace-readable path consumed by Pi `read`; `evidence_add` also accepts that readable path and canonicalizes it internally.
- Repeated the exact acute-stroke prompt. Wall time fell from 164.51 to 111.47 seconds; traced time from 163.001 to 109.905 seconds; turns from 33 to 17; tool calls from 52 to 30; first evidence from 85.72 to 40.099 seconds; PubMed searches from 13 to 4; shell calls from 13 to 1.
- The rerun exposed two smaller mechanical errors. Archive output now states its total valid offset range, and `pubmed_read` strips common `PMID:`, `PMCID:`, and `DOI:` labels before identifier resolution.

### Network acquisition output aligned with the Python EBM contract

- Kept Pi's general-purpose `read` unchanged. Enhanced only model-visible output from read-like network tools.
- `web_read`, `pubmed_read`, and `guideline_mcp_read` now archive the complete normalized source while returning at most a 5KB exact preview, a heading map with up to 20 one-based line locations, total archive lines, and a copyable Pi `read(path, offset, limit)` continuation hint.
- Converted archive/evidence windows from zero-based offsets to one-based lines so Pi `read` output can be passed directly to `evidence_add` without arithmetic or off-by-one risk.
- Added pre-archive external-text cleaning for numeric/common HTML entities, NBSP/thin spaces, zero-width characters, soft hyphens, BOMs, and invalid control characters.
- Removed common inline formatting tags before PubMed XML parsing so mixed content such as `<i>p</i> &lt; 0.001` retains word order instead of becoming detached `p p p` tokens.
- Guideline MCP read responses that contain a JSON envelope now archive only the embedded Markdown under the semantic guideline title, rather than archiving transport fields and hash-like `doc_id` values as the document body/name.
- PubMed ESearch now requests relevance ordering explicitly. Empty searches remain reproducible retrieval artifacts but are marked `Status: no_results` with an explicit no-match message.
- A direct network check for `NINDS rt-PA acute ischemic stroke` returned an archived result with one-based `bodyLineStart`, no encoded numeric entities, and `Status: completed`.
- Ported the useful directory contract from Python `ToolArchiver`: each read source now occupies a semantic directory with canonical `full.md` and generated `toc.md`. The TOC records total lines, hierarchical Markdown sections, one-based ranges, and short previews without duplicating the source body.
- Guideline search JSON arrays are rendered into normal Markdown result sections (`## title`, document metadata bullets, optional excerpt) before archive. This establishes the rule that `.md` archives contain semantic documents, not renamed transport JSON.
- Closed the generic PDF fallback gap: recognized PDF URLs now use MinerU Premium `model_version: vlm` by URL first; if origin fetching fails, `web_read` safely downloads the PDF with public-DNS/redirect validation, a 25-second default timeout, 50 MB cap, and `%PDF-` validation, then retries through Premium signed-byte upload before web-reader degradation.
- MinerU-derived archives now use the first Markdown H1 as their semantic source-directory title when available, instead of preferring opaque download filenames.
- Added public-DNS/redirect-validated HEAD probing for extensionless PDF endpoints before selecting the MinerU path. Downloaded content still requires `%PDF-` validation before signed upload.
- Pi cancellation now propagates through web/PubMed requests, OpenAlex resolution/PDF download, MinerU creation/polling/upload/ZIP retrieval, and polling delays. Web/PubMed reads also have overall 240-second budgets rather than only independent per-request timers.
- MinerU ZIP handling now retains only bounded image assets actually referenced by `full.md` (200 files, 10 MB each, 50 MB total), preserves their relative links beside the source, and writes hashes to `.metadata/resources.json`; unreferenced transport JSON, layout intermediates, and binary copies are discarded.
- Split PubMed batch persistence without adding network rounds: `sources/search/` remains reproducible query history, while every complete abstract is independently archived as semantic `sources/read/<article>/full.md` and advertised as `primary_abstract`. `evidence_add` now rejects all `sources/search/` paths mechanically.
- Hardened model-output completeness: every archive truncation now includes a copyable continuation command with an overlapping next offset, partial heading maps disclose the omitted count and point to complete `toc.md`, and truncated `evidence_read` output uses a Pi-readable workspace path rather than an unreachable session-relative path.
- PubMed search snapshots now begin with a compact all-hit/abstract-path index. Similar-article hints include ESummary title plus available journal/date and a copyable `pubmed_read` next action instead of exposing bare PMIDs.
- Removed the model-controlled guideline `max_chars` knob and request the MCP maximum of 500,000 characters so the archive layer, rather than an early tool argument, owns model-visible truncation and continuation.

### Real E2E verification: direct PubMed abstract evidence

- A broad stroke case completed successfully in 108.98 wall-clock seconds, but trajectory analysis found 12 fast `evidence_add` failures because the model passed Pi-readable session paths where the tool expected session-relative paths. `evidence_add` now canonicalizes the current semantic workspace form and legacy UUID form, while rejecting paths naming another session.
- Ran a constrained abstract-only case asking whether alteplase benefit declines with treatment delay. It made exactly one `pubmed_search`, no `pubmed_read`, selected the separately archived Cochrane abstract (PMID 12917889), created `primary_abstract` evidence from exact lines, and wrote a verified Chinese report.
- Wall time was 45.45 seconds; traced time 43.861 seconds; 7 turns; 6 tool calls; 0 errors; no duplicate actions; first evidence at turn 5 / 33.882 seconds. This verifies that citation-capable PubMed abstracts do not require another network retrieval.
- The trajectory still showed one shell call used to count lines after generic Pi `read`. PubMed tool output now proactively returns each abstract's session-relative evidence path, Pi-readable path, exact complete abstract line range, and copyable bounded `read` command, with continuation for an exceptional abstract over 200 lines.
- Repeated the real abstract-only workflow after that navigation change. It completed in 23.96 wall-clock / 22.54 traced seconds with 6 turns, 5 tool calls, 0 errors, no duplicates, and first evidence at turn 3 / 11.305 seconds. The exact chain was one `pubmed_search` → one targeted `read` → one `primary_abstract` `evidence_add` → `evidence_read` → `report_write`; there was no `pubmed_read`, shell, web, or guideline call.
