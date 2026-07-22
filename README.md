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
- optional internal guideline MCP search/read when `GUIDELINE_MCP_URL` is configured
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
src/tools/              archive, web, MinerU, PubMed, MCP, evidence, and report logic
.pi/extensions/         project-local Pi extension entry points
.pi/skills/             EBM research and report-writing skills
docs/                   specs, ADRs, acceptance criteria, and persistent development state
vendor/pi-coding-agent/ project-pinned Pi package without node_modules
tests/                  Vitest unit, integration-boundary, and vertical-flow tests
```

## Developer demo: interactive TUI

Requirements: Git, Node.js 24+, a DeepSeek API key, and a terminal.

```bash
git clone https://github.com/V-rand/EBM_ts.git
cd EBM_ts
npm install
cp .env.example .env
# Edit .env and set DEEPSEEK_API_KEY
npm run ebm
```

`npm run ebm` is the single launcher. It loads the ignored local `.env` and launches Pi's interactive TUI.

The demo is isolated from any globally installed Pi:

- executable: repository-local `node_modules/.bin/pi` pinned through `vendor/pi-coding-agent/`;
- Pi runtime/config directory: ignored `data/pi-agent/`, not `~/.pi/agent/`;
- conversations: ignored `data/pi-sessions/`;
- EBM artifacts: ignored `data/sessions/{shortPiId}_{semantic-name}/`, with the full Pi UUID retained in hidden metadata;
- resources: only the two project EBM extensions and two project EBM skills are loaded.

A developer's global Pi packages, extensions, skills, settings, sessions, and authentication files are therefore neither loaded nor modified. Model credentials for this demo come from the project `.env`. `EBM_PI_AGENT_DIR=/another/path npm run ebm` may be used when a developer explicitly wants a different isolated runtime directory.

A workspace name is fixed before the first agent turn. A startup/TUI session name takes precedence; otherwise a bounded Unicode-preserving name is derived mechanically from the first prompt. Use `npm run ebm -- --name "AML CR1巩固治疗"` when an explicit concise name is desired. Later `/name` changes only Pi's display name and does not move an established workspace, so previously returned source continuation paths remain valid. Existing UUID-only workspaces are opened in place and are not migrated.

Type a clinical question directly into the TUI. Useful commands:

```text
/name stroke-thrombolysis     name the current research session
/session                     show the current session ID and file
/new                         start a new research session
/resume                      select a previous session
/compact                     compact a long conversation
/quit                        exit
```

From the shell:

```bash
npm run ebm -- --continue    # continue the most recent session
npm run ebm -- --resume      # browse and select a saved session
npm run check                # deterministic local validation
```

On first launch, Pi trusts the project-local extension because the launcher passes `--approve`. Review cloned extension code before running it; Pi extensions execute with the user's local permissions.

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
| `web_read` | Recognized PDFs: MinerU Premium VLM URL → secure local download + Premium upload → Jina/Firecrawl; other pages: Jina → Firecrawl |
| `pubmed_search` | Top PubMed records with title, PMID, 500-character abstract preview, evidence source path, and exact abstract lines |
| `pubmed_similar` | Top similar PubMed records from one PMID, with title, PMID, and 500-character abstract preview for retrieval expansion |
| `pubmed_read` | PMC full text first, then bounded OpenAlex OA PDF download + MinerU upload, with explicit abstract-only fallback |
| `guideline_mcp_search` | compact Top-5 internal guideline document candidates with title, doc_id, metadata, and abstract/excerpt preview |
| `guideline_mcp_retrieve` | compact Top-5 internal guideline RAG chunks, each archived with readable chunk path and exact lines for direct evidence when sufficient |
| `guideline_mcp_read` | read and archive one selected guideline |
| `evidence_add` | archive an exact source line window with explicit evidence provenance |
| `evidence_list` | list concise evidence metadata |
| `evidence_read` | read and reverify evidence against its source |
| `report_write` | write a report only after verifying all referenced evidence |

Read-like network tools retain each complete normalized source as `sources/read/<semantic-name>/full.md` with a generated `toc.md`. Read tools return only a compact 5KB preview, a one-based heading map, readable paths, total lines, and a Pi `read(path, offset, limit)` continuation hint. Web search is discovery-only and returns Top-K candidate URLs with provider summaries instead of archive previews. PubMed additionally returns exact per-abstract read windows. Pi `read` and `evidence_add` use the same one-based source lines. Structured provider envelopes are rendered as semantic Markdown before archive rather than copied as JSON into `.md` files.

## Product boundary

The repository is currently a developer-facing TUI demo of an EBM research assistant, not an end-user clinical product. Clinical reasoning and writing quality are guided through `AGENTS.md` and the EBM skills rather than a rigid report-format gate; `report_write` mechanically verifies only cited evidence integrity and eligibility. It is not a regulated medical device and must not be treated as autonomous clinical decision support. Reports remain subject to clinician review, patient-specific verification, source-level checking, and local privacy/governance requirements. Do not enter identifiable patient data unless the selected model provider and deployment environment are approved for that use.

## Developer trajectory logs

The project extension records Pi lifecycle events outside model context:

```text
data/sessions/{shortId}_{semantic-name}/trace/trajectory.md     # human-readable thinking/tool trajectory
data/sessions/{shortId}_{semantic-name}/trace/trajectory.jsonl  # machine-readable eval stream
```

The recorder uses Pi's native message, turn, tool, provider, model, compaction, and session hooks. It stores finalized thinking blocks when the provider exposes them, tool arguments/results and durations, end-to-end/turn/model/provider timing in seconds, token/cache usage, and runtime configuration hashes. It never calls `sendMessage()` or `appendEntry()`, so trace data is not sent to the model. Structured secret fields and common embedded Authorization, OAuth, API-key, cookie, and Lark webhook forms are redacted. Trace files are local, ignored by git, and created with owner-only permissions. Pi's native session JSONL may still preserve diagnostic text that was already exposed to the model, so credentials must never be printed by tools or diagnostics.

Pi's generated default system prompt and complete general-purpose tool set are retained; a project extension changes only the opening coding-agent identity to an EBM-agent identity. Detailed clinical behavior remains in project context and lazily loaded skills.

Analyze the newest trace or an explicit file:

```bash
npm run trace:analyze
npm run trace:analyze -- data/sessions/<workspace>/trace/trajectory.jsonl
```

## Checks

```bash
npm run typecheck
npm run test
npm run lint:boundaries
npm run check
npm run test:network  # optional single real DeepSeek smoke request with diagnostics
```

The normal check suite is deterministic and does not require network access. Real integration checks are deliberately separate.
