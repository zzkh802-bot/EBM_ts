# Current State

Read this first after context compaction.

## Active task

Add Markdown evidence read/list behavior, then Pi extension tool exposure.

## Last known state

- Repository: `~/dev/EBM_ts`
- Branch: `main`
- Remote clean at commit `cd93237` before new implementation work (later docs commit `c67f755`; ADR implementation defaults `cd93237`; verify with git log).
- Markdown normalization/archive and Markdown evidence persistence implemented; `npm run check`: 6 files / 11 tests passing.
- `.env` exists locally and is ignored.
- Pi runtime is vendored but extensions are preferred.

## Non-negotiable decisions

- Normalize reader output before both archive and model-visible output; exact same line numbering.
- Evidence source of truth is Markdown, no redundant raw JSON body.
- Web pages: Jina first, Firecrawl fallback.
- PDFs: MinerU Premium first; if remote fetch fails, local download then upload; local parser fallback.
- General search: Tavily first. Biomedical: PubMed-specific tools.
- PubMed split: `pubmed_search` and `pubmed_read`.
- Internal guideline MCP retained from Python config.
- Default model: DeepSeek V4 Flash using Pi provider support where possible.
- No old session migration, no subagents, no SQLite.

## Recently completed

- `src/tools/markdown.ts`: deterministic wrapping, fence/table preservation.
- `archiveSource()` normalizes before hash/path/write/model-visible return.
- `addEvidence()` writes Markdown exact-quote records and `EVIDENCE.md`; traversal/symlink escape is rejected.

## Next command

```bash
cd ~/dev/EBM_ts && git status --short --branch && npm run check
```

Then add one failing behavior test for public evidence listing/reading.
