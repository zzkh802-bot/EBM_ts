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
- `pubmed_search` returns batched archived abstracts plus bounded ELink similar-article hints in one call.
- `pubmed_read` resolves identifiers and acquires PMC JATS full text when available.
- Without usable PMC text, it performs one bounded OpenAlex OA-PDF lookup, validates DNS and every redirect, downloads at most 50 MB, and uploads local bytes to MinerU; failures remain explicit abstract-only results.
- Real checks passed for PMC full text (PMID 33884067) and OpenAlex → local download → MinerU upload (PMID 36780904, 53,742 archived characters).
- Evidence records carry provenance classes; discovery-only snippets and unverified guideline mirrors are mechanically citation-ineligible. PubMed abstracts remain citation-eligible for claims explicitly present in them.
- The EBM skill now pivots from unavailable target guidelines to verified mirrors, attributed secondary evidence, or independent guidelines without conflating their claims.
- `report_write` verifies every Markdown evidence reference against its archived source; evidence-gap reports require explicit opt-in.
- `guideline_mcp_search` and `guideline_mcp_read` use a sequential Streamable HTTP client and archive all output; real internal search/read checks passed.
- `web_read` now routes PDF/Office/e-book URLs through MinerU Premium first; real demo PDF parsing returned 51,291 Markdown characters.
- Migrated the Python clinical report-writing skill and adapted obsolete tool references to Pi/evidence IDs.
- Vertical acceptance covers discovery archive → exact evidence → verified report.
- Pi `session_compact` summaries are atomically mirrored as project-local JSON artifacts without replacing Pi compaction behavior.
- Source and report artifacts now use Unicode-preserving semantic filenames with numeric collision suffixes; SHA-256 remains metadata rather than filename content.
- No dedicated user-upload workflow is planned; MinerU remains the direct document capability.
- `npm run check`: 15 test files / 44 tests passing.

## Non-negotiable decisions

- Pi owns runtime, events, tool calling, provider streaming, compaction, and TUI.
- Normalize network content before archive and model visibility; preserve identical line numbering.
- Evidence source of truth is Markdown; no redundant raw JSON body.
- Web pages: Jina first, Firecrawl fallback. PDFs: MinerU Premium first, then download/upload, then local fallback.
- General search: Tavily first; biomedical search: PubMed-specific tools.
- Guideline MCP calls are explicit, timeout-bounded, and initially sequential.
- No old session migration, subagents, scheduler, or SQLite.

## Active task

Basic refactor is complete. Next priority is measuring whether the improved acquisition ladder reduces model rounds and report errors before experimenting with lazy POMDP belief state.

## Next commands

```bash
cd ~/dev/EBM_ts
git status --short --branch
npm run check
```
