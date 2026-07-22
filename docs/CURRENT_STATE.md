# Current State

Read this first after context compaction.

## Basic-refactor target

Continue without pausing for optional polish until this local Pi-first MVP works end to end:

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
- `pubmed_search` and `pubmed_read` use official E-utilities parameters, direct IPv4, bounded retries, and archived Markdown outputs.
- Real PubMed search/read checks passed with configured email and API key.
- `report_write` verifies every Markdown evidence reference against its archived source; evidence-gap reports require explicit opt-in.
- `npm run check`: 10 test files / 24 tests passing.

## Non-negotiable decisions

- Pi owns runtime, events, tool calling, provider streaming, compaction, and TUI.
- Normalize network content before archive and model visibility; preserve identical line numbering.
- Evidence source of truth is Markdown; no redundant raw JSON body.
- Web pages: Jina first, Firecrawl fallback. PDFs: MinerU Premium first, then download/upload, then local fallback.
- General search: Tavily first; biomedical search: PubMed-specific tools.
- Guideline MCP calls are explicit, timeout-bounded, and initially sequential.
- No old session migration, subagents, scheduler, or SQLite.

## Active task

Implement sequential guideline MCP search/read with timeout and malformed-protocol coverage.

## Next commands

```bash
cd ~/dev/EBM_ts
git status --short --branch
npm run check
```
