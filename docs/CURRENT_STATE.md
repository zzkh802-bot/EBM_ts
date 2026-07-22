# Current State

Read this first after context compaction.

## Basic-refactor milestone — COMPLETE

The local Pi-first MVP now works end to end:

1. launch native Pi TUI with DeepSeek V4 Flash;
2. search/read web and PubMed sources with explicit errors;
3. normalize and archive every model-visible external result;
4. create/read/list exact-quote Markdown evidence;
5. write a Markdown report whose evidence references can be verified;
6. retain Xinqiong OpenAI-compatible and guideline MCP adapters;
7. pass local checks plus small, separately-invoked network smoke checks.

Not required for this milestone: cloud API/multi-user auth, scheduler, subagents, SQLite, historical migration, advanced UI, or exhaustive provider benchmarking.

## Last verified state

- Repository: `~/dev/EBM_ts`; branch `main`.
- Markdown normalization/archive and Markdown evidence add/list/read are implemented.
- Project extension registers `evidence_add`, `evidence_list`, and `evidence_read` through Pi and emits `ebm:evidence_added`.
- Concurrent evidence writes use Pi's file mutation queue.
- Pi native `deepseek/deepseek-v4-flash` is the default; Xinqiong is an OpenAI-compatible endpoint using `OPENAI_API_KEY`.
- Real direct calls verified DeepSeek thinking off/on, DeepSeek tool calls, and Xinqiong thinking/tool calls.
- `npm run ebm` loads `.env`, launches native Pi TUI, and stores Pi sessions locally.
- `web_read` (Jina → Firecrawl fallback) and `web_search` (Tavily) normalize/archive before model exposure and return explicit provider attempts on failure.
- Real proxy-environment checks passed for Jina reading NCBI and Tavily search.
- `pubmed_search` still retrieves abstracts in one batch, but now persists query/result history under `sources/search/` and each complete abstract as its own semantic `sources/read/<article>/full.md`; a compact leading index exposes every citation-capable path before long bodies. Similar ELink/ESummary hints remain discovery-only but include PMID, title, available journal/date, and an explicit `pubmed_read` next action.
- `pubmed_read` resolves identifiers and acquires PMC JATS full text when available.
- Without usable PMC text, it performs one bounded OpenAlex OA-PDF lookup, validates DNS and every redirect, downloads at most 50 MB, and uploads local bytes to MinerU; failures remain explicit abstract-only results.
- Real checks passed for PMC full text (PMID 33884067) and OpenAlex → local download → MinerU upload (PMID 36780904, 53,742 archived characters).
- Evidence records carry provenance classes; `evidence_add` now mechanically rejects every `sources/search/` snapshot, and discovery-only snippets/unverified mirrors are citation-ineligible. Separately archived PubMed abstracts remain citation-eligible for claims explicitly present in them.
- The EBM skill now pivots from unavailable target guidelines to verified mirrors, attributed secondary evidence, or independent guidelines without conflating their claims.
- `report_write` verifies every Markdown evidence reference against its archived source; evidence-gap reports require explicit opt-in.
- `guideline_mcp_search` and `guideline_mcp_read` use a sequential Streamable HTTP client and archive all output; real internal search/read checks passed.
- `web_read` routes recognized PDF/Office/e-book URLs through MinerU Premium VLM first. Extensionless PDF candidates are detected through a public-DNS/redirect-validated HEAD Content-Type probe. For PDFs that MinerU cannot fetch by URL, it performs one SSRF-guarded, redirect-checked, 50 MB bounded local download and retries through MinerU Premium signed upload before Jina/Firecrawl; real direct-URL parsing returned 51,291 Markdown characters.
- Migrated the Python clinical report-writing skill and adapted obsolete tool references to Pi/evidence IDs; removed the legacy mandatory `research_frame.md` workflow.
- Pi's generated system prompt and general-purpose tools remain intact; a `before_agent_start` extension replaces only the opening coding-agent identity with an EBM-agent identity.
- Vertical acceptance covers discovery archive → exact evidence → verified report.
- Pi `session_compact` summaries are atomically mirrored as project-local JSON artifacts without replacing Pi compaction behavior.
- A project-local Pi trajectory recorder writes developer-only `trajectory.md` and `trajectory.jsonl` files with finalized thinking, responses, tool lifecycle/timing, provider request status, model configuration, usage, compaction, and session events. It never enters model context.
- `npm run trace:analyze` summarizes end-to-end, turn, first-delta, model, provider, tool, and first-evidence timing in seconds, plus duplicate actions, failures, full-text outcomes, thinking volume, and token/cache usage.
- Source and report artifacts use Unicode-preserving semantic names with numeric collision suffixes; read sources use semantic directories containing `full.md`/`toc.md`, and SHA-256 remains metadata rather than a path component.
- No dedicated user-upload workflow is planned; MinerU remains the direct document capability.
- Acute-stroke real E2E baseline completed in 164.51 wall-clock seconds (163.001 traced seconds): 33 turns, 52 tool calls, and first evidence at 85.72 seconds.
- After returning a separate workspace-readable archive path, the fixed-case rerun completed in 111.47 wall-clock seconds (109.905 traced seconds): 17 turns, 30 tool calls, first evidence at 40.099 seconds, 4 PubMed searches instead of 13, and 1 shell call instead of 13. Both runs produced verified reports.
- Read-like network tools (`web_read`, `pubmed_read`, `guideline_mcp_read`) archive each complete normalized source as `sources/read/<semantic-name>/full.md` plus generated `toc.md`, but expose only a 5KB model preview, up to 20 one-based heading-map entries, readable full/TOC paths, total lines, and an exact gap-free continuation command that deliberately overlaps the last preview line. Partial maps disclose their count and point to complete `toc.md`. MinerU additionally retains only referenced bounded image assets beside `full.md`, with hashes in `.metadata/resources.json`; transport JSON and unreferenced ZIP internals are discarded.
- Archive renderers convert structured provider results into semantic Markdown sections before persistence. Guideline MCP search arrays become result headings/metadata/excerpts; transport JSON is not copied into `.md` source bodies.
- Source/evidence line windows are uniformly one-based to match Pi `read`; archive metadata now uses `bodyLineStart` rather than a zero-based offset.
- External source normalization decodes numeric/common HTML entities, removes zero-width/control characters, normalizes Unicode spacing, and preserves PubMed mixed inline XML text order. Guideline MCP JSON envelopes are reduced to their semantic title and Markdown content before archive.
- PubMed search explicitly uses relevance ordering and marks zero-result archives as `Status: no_results`; `pubmed_read` accepts model-natural `PMID:`, `PMCID:`, and `DOI:` prefixes.
- A dedicated abstract-only real E2E initially completed in 45.45 wall-clock seconds but used an avoidable shell call to count source lines. After adding evidence-ready abstract paths and exact read windows to `pubmed_search`, the identical workflow reran in 23.96 wall-clock / 22.54 traced seconds: 6 turns, 5 tool calls, 0 errors, no duplicates, one search, one targeted read, no `pubmed_read` or shell, first evidence at 11.305 seconds, one `primary_abstract` record, and a verified report.
- `evidence_add` accepts either the returned session-relative evidence path or the current session's Pi-readable `data/sessions/<id>/...` path and canonicalizes it; other-session paths remain rejected.
- `npm run check`: 18 test files / 58 tests passing.

## Non-negotiable decisions

- Pi owns runtime, events, tool calling, provider streaming, compaction, and TUI.
- Normalize network content before archive and model visibility; preserve identical line numbering.
- Evidence source of truth is Markdown; no redundant raw JSON body.
- Web pages: Jina first, Firecrawl fallback. Recognized or Content-Type-detected PDFs: MinerU Premium VLM URL task first, then bounded secure download and Premium VLM signed upload, then Jina/Firecrawl. Pi cancellation and a 240-second total read budget propagate through probing, download, MinerU polling/upload/ZIP retrieval, and web fallbacks.
- General search: Tavily first; biomedical search: PubMed-specific tools.
- Guideline MCP calls are explicit, timeout-bounded, and initially sequential.
- No old session migration, subagents, scheduler, or SQLite.

## Active task

Basic refactor is complete. The first measured acquisition-locality fix reduced the same case from 33 to 17 turns and from 163.001 to 109.905 traced seconds without adding research state. Run additional fixed cases before deciding whether further prompt, tool, cancellation, or lazy belief-state changes are justified.

## Next commands

```bash
cd ~/dev/EBM_ts
git status --short --branch
npm run check
```
