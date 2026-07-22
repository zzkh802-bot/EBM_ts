# EBM Agent TS

A lean TypeScript EBM research agent built on Pi's native async runtime, extension system, providers, events, compaction, and TUI.

This is a new implementation rather than a line-by-line Python port. Pi owns the generic agent runtime; this project adds only traceable evidence-based medicine capabilities.

## Current status

The basic local refactor milestone is complete:

- Pi-native TUI and DeepSeek V4 Flash default
- Xinqiong OpenAI-compatible provider option
- Tavily web search with archived result sets
- Jina web reading with Firecrawl fallback
- MinerU Premium document parsing
- PubMed ESearch/ESummary/EFetch integration
- sequential internal guideline MCP search/read
- normalized Markdown source archives with stable absolute line offsets
- exact-quote Markdown evidence add/read/list and verification
- verified Markdown report writing
- migrated EBM research and clinical report-writing skills

Known follow-up work is tracked in `docs/ACCEPTANCE.md` and `docs/CURRENT_STATE.md`.

## Intentional non-goals

- no SQLite; files, Markdown, and JSON are authoritative
- no subagents or scheduler/reminders
- no historical Python session migration
- no duplicated generic file/code tools; use Pi native tools
- no custom AgentLoop, provider streaming state machine, or TUI
- no silent fallback that hides network or evidence failures

## Repository layout

```text
src/extensions/         Pi tool registration and event integration
src/providers/          Xinqiong endpoint registration; official DeepSeek stays Pi-native
src/session/            JSON session metadata prototype
src/tools/              archive, web, MinerU, PubMed, MCP, evidence, and report logic
.pi/extensions/         project-local Pi extension entry points
.pi/skills/             EBM research and report-writing skills
docs/                   specs, ADRs, acceptance criteria, and persistent development state
vendor/pi-coding-agent/ project-pinned Pi package without node_modules
tests/                  Vitest unit, integration-boundary, and vertical-flow tests
```

## Setup and launch

```bash
cd ~/dev/EBM_ts
npm install
npm run check
npm run ebm
```

`npm run ebm` loads the ignored local `.env`, launches the project-local Pi runtime, stores Pi conversations under `data/pi-sessions/`, and isolates EBM artifacts under `data/sessions/{piSessionId}/`.

Project settings default to:

```text
deepseek/deepseek-v4-flash
```

The extension also registers:

```text
xinqiong/deepseek-v4-flash
```

## EBM tools

| Tool | Purpose |
| --- | --- |
| `web_search` | Tavily discovery; archives normalized result sets |
| `web_read` | MinerU for document URLs, otherwise Jina then Firecrawl |
| `pubmed_search` | PubMed discovery through ESearch and ESummary |
| `pubmed_read` | PMID/PMCID/DOI resolution and PubMed abstract reading |
| `guideline_mcp_search` | sequential internal guideline document search |
| `guideline_mcp_read` | read and archive one selected guideline |
| `evidence_add` | archive an exact source line window as Markdown evidence |
| `evidence_list` | list concise evidence metadata |
| `evidence_read` | read and reverify evidence against its source |
| `report_write` | write a report only after verifying all referenced evidence |

## Checks

```bash
npm run typecheck
npm run test
npm run lint:boundaries
npm run check
npm run test:network  # optional single real DeepSeek smoke request with diagnostics
```

The normal check suite is deterministic and does not require network access. Real integration checks are deliberately separate.
