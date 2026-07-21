# ADR-0001: Pi-first architecture for EBM Agent TS

## Status

Accepted.

## Context

The Python EBM Agent OS grew into a custom agent runtime with its own AgentLoop, tool runtime, SQLite store, subagent layer, scheduler, memory files, and many overlapping tool families. This made the system harder to audit and increased the chance that EBM-specific bugs were hidden behind generic runtime complexity.

The TypeScript rewrite is based on Pi Coding Agent. Pi already provides an asynchronous agent/session runtime, provider registry, native tools, event stream, extension hooks, skills, compaction, session management, and SDK/web integration points.

## Decision

EBM Agent TS will be **Pi-first**.

Pi is the agent runtime source of truth. The EBM project adds only domain capabilities that Pi does not already provide.

## Rules

1. **Use Pi native runtime before adding custom runtime code.**
   - Do not rebuild AgentLoop, ToolRuntime, message state machine, tool-call closure, retry, or compaction unless a failing executable test proves Pi cannot satisfy the requirement.

2. **Keep all EBM capabilities async-first.**
   - Web search, web read, MinerU parsing, source archive, evidence write/read, and report generation must be asynchronous.
   - Tool/API failures must be returned as explicit structured errors, not hidden behind silent fallback.

3. **Use Pi event stream and extension hooks.**
   - Cloud/web UI should bridge Pi session events to SSE/WebSocket rather than inventing a separate output protocol.
   - EBM domain events should be emitted from extensions/tools when useful, e.g. `ebm:source_archived`, `ebm:evidence_added`, `ebm:retrieval_failed`, `ebm:report_written`, `ebm:compaction_snapshot_saved`.

4. **Use Pi provider registry.**
   - Keep Pi native provider support, including OpenAI/Codex and other built-ins.
   - Add DeepSeek Official and Xinqiong as project-local providers via Pi extension registration.
   - Do not implement custom streaming providers unless provider compatibility tests fail against Pi's OpenAI-compatible transport.

5. **Use Pi native tools where possible.**
   - Prefer `read`, `write`, `edit`, `grep`, `find`, `ls`, and carefully-scoped `bash`.
   - Do not create duplicate file/code/writing tool families.
   - Add only EBM-specific tools: search/read adapters, MinerU parsing, source archive, exact-quote evidence JSON, and report helpers.

6. **Use Pi skills ecosystem.**
   - Use Pi's progressive-disclosure skills for EBM workflows.
   - Integrate Pi ecosystem search/read skills only if they satisfy EBM archive/provenance requirements.

7. **Keep storage simple.**
   - Use JSON and files as source of truth.
   - Do not introduce SQLite, ORM, LangChain, LlamaIndex, or indexing frameworks in the foundation.
   - Generated indexes are allowed only as rebuildable caches, not source of truth.

8. **No subagents in v1.**
   - Pi has examples for subagents, but EBM TS v1 should not add subagents until a specific failing test/product need justifies them.

9. **No scheduler/reminder layer in v1.**
   - The first cloud EBM product is interactive research, not background reminders.

10. **No AGENTS/SOUL/MEMORY runtime indirection in v1.**
    - Keep prompt/context stable and simple. Use Pi system prompt/resource loader/skills instead.

11. **Context overflow uses Pi compaction.**
    - Do not fork sessions because context is full.
    - If EBM needs durable compaction state, write an additional JSON summary inside the same session.

12. **Tests are executable boundaries.**
    - Acceptance tests must be code assertions, not natural-language claims.
    - Every regression-prone integration must get a test before or with implementation: Jina URL handling, MinerU errors, source archive path stability, evidence exact quote matching, provider API errors, and tool-call JSON behavior.

## Consequences

Positive:

- Less custom runtime code to audit.
- Better alignment with Pi's async/event/hook ecosystem.
- Easier future web integration through Pi SDK and session events.
- Lower risk of Python-version complexity returning under new names.

Tradeoffs:

- Some Pi internals may need project-specific patches under `vendor/pi-coding-agent/`.
- EBM constraints must be enforced by small domain tools/tests rather than a large custom kernel.
- We depend on Pi provider/tool semantics, so provider compatibility tests are mandatory before production use.

## Implementation notes

Current foundation already follows this ADR:

- `vendor/pi-coding-agent/` contains a project-local Pi copy, isolated from the global `pi` install.
- `.pi/extensions/ebm-providers.ts` registers EBM-specific providers.
- `.pi/skills/ebm-research/SKILL.md` defines the initial EBM workflow skill.
- `src/tools/*` contains only domain helpers, not an agent runtime.
- `scripts/check-boundaries.ts` rejects SQL/framework bloat in the foundation.
