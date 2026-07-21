# Foundation Log

## 2026-07-21

Completed repository foundation work for the TypeScript EBM rewrite.

Actions:

- Cloned `git@github.com:V-rand/EBM_ts.git` into `~/dev/EBM_ts`.
- Copied Python repo `.env` into the new repo for local development; `.env` is ignored by Git.
- Copied `.env.example` for documented variable names.
- Vendored Pi Coding Agent into `vendor/pi-coding-agent/` excluding `node_modules`, so local EBM changes do not affect the global `pi` install.
- Added TypeScript project config, npm scripts, strict typecheck, Vitest tests, and boundary checks.
- Added project-local Pi provider extension for DeepSeek Official and Xinqiong.
- Added initial EBM skill under `.pi/skills/ebm-research/`.
- Added specs and acceptance docs.
- Recorded Pi-first architecture decision in `docs/adr/0001-pi-first-architecture.md`.

Validated:

```bash
npm run check
npm run build
```

Results:

- TypeScript typecheck passed.
- Vitest: 5 files, 7 tests passed.
- Boundary check passed.
- Build passed.

Important non-goals preserved:

- no SQLite dependency
- no subagent layer
- no scheduler/reminder layer
- no AGENTS/SOUL/MEMORY runtime indirection
- no duplicate read/write tool families
