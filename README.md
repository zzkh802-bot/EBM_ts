# EBM Agent TS

TypeScript rewrite foundation for the EBM research agent, built on a project-vendored copy of Pi Coding Agent.

This repository is intentionally a new implementation, not a line-by-line Python port. The design keeps Pi's minimal runtime advantages and adds only the EBM capabilities needed for traceable evidence-based medicine research.

## Current status

Foundation only. This repo currently contains:

- vendored Pi runtime under `vendor/pi-coding-agent/` so project-specific changes cannot affect the globally installed `pi` command
- copied local `.env` for development use, ignored by Git
- project-local Pi extension registering DeepSeek Official and Xinqiong providers
- TypeScript skeleton modules for JSON sessions, source archives, URL safety, and exact-quote evidence JSON
- executable tests for the foundation invariants
- architecture/spec documents for the rewrite

## Non-goals for the first TS version

The Python implementation accumulated several generic runtime systems that are not needed for the first cloud product. The TS version deliberately omits them unless tests prove they are needed:

- no SQLite; session state and evidence indexes are JSON plus Markdown/source files
- no subagents in v1
- no reminders/scheduler
- no AGENTS.md/SOUL.md/MEMORY indirection
- no duplicated read/write/code tool families; use Pi native tools and a small number of EBM-specific tools
- no defensive `try { } catch {}` that hides failures

## Repository layout

```text
src/
  app/                  Pi SDK session factory for EBM runtime
  providers/            DeepSeek official + Xinqiong provider registration
  session/              JSON session store
  tools/                EBM-specific source archive, evidence, URL safety helpers
.pi/
  extensions/           Project-local Pi extensions
  skills/               Project-local EBM skill(s)
docs/
  SPEC.md               Product and engineering spec
  ACCEPTANCE.md         Test-backed acceptance criteria
vendor/pi-coding-agent/ Vendored Pi package without its node_modules
tests/                  Vitest regression/acceptance tests
```

## Setup

```bash
cd ~/dev/EBM_ts
npm install
npm run check
```

The local `.env` has been copied from the Python repo and is ignored by Git. Keep real credentials out of commits.

## Pi usage

Interactive local run after install:

```bash
cd ~/dev/EBM_ts
pi --approve
```

Project-local settings load `.pi/extensions/ebm-providers.ts`, registering:

- `deepseek-official/deepseek-chat`
- `deepseek-official/deepseek-reasoner`
- `xinqiong/deepseek-v4-flash`

Pi already supports many native providers, including OpenAI/Codex. This project keeps those native providers instead of wrapping them.

## Development checks

```bash
npm run typecheck
npm run test
npm run lint:boundaries
npm run check
```

Tests are code assertions, not natural-language checklists. They currently verify:

- source archive determinism and metadata persistence
- exact quote evidence JSON and verification
- JSON session compaction summary behavior
- outbound URL safety and Jina Reader scheme preservation
- provider catalog registration
- boundary rule: no SQL/framework bloat in foundation
