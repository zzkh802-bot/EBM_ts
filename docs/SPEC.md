# EBM Agent TS Spec

## Goal

Build a cloud-oriented, one-user-one-agent EBM research assistant on top of Pi's TypeScript agent runtime. The system must preserve or improve the Python version's core EBM guarantees while deleting unnecessary runtime machinery.

## Product target

The final product is a web agent service. A user opens a research workspace, asks a clinical/research question, uploads documents if needed, and receives a traceable EBM report. Each workspace is isolated by session id and persisted as files/JSON.

## Core EBM guarantees

1. Claims must not cite model memory.
2. External sources must be archived before they support a claim.
3. Evidence nodes must contain an exact source quote, source path, and line range.
4. Reports must distinguish guideline/systematic-review/RCT/observational/regulatory/background evidence.
5. Missing evidence must be represented as a gap, not hallucinated support.
6. Tool/API failures must be visible to the model and logs; no silent fallback that changes semantics.

## Architecture decisions

### Runtime

Use Pi SDK and project-local extensions. Keep Pi's native session/compaction/tool-call handling unless a failing test proves it is insufficient.

### Storage

Use files and JSON:

```text
data/sessions/{sessionId}.json       # user/session metadata and message summaries
data/sessions/{sessionId}/sources/   # archived search/read/upload outputs
data/sessions/{sessionId}/evidence/  # evidence node JSON files
data/sessions/{sessionId}/reports/   # final Markdown reports
```

No SQLite in v1. Search indexes can be added later as generated cache files, not source of truth.

### Tools

Use Pi native `read`, `write`, `edit`, `grep`, `find`, `ls`, and optionally `bash` for local development. Add only EBM-specific tools:

- `web_search` adapter with source archive output
- `web_read` adapter using Jina first, Firecrawl fallback, and explicit failure objects
- `parse_document` adapter using MinerU for PDF/Office when configured
- `evidence_add` exact quote JSON writer
- `evidence_list` / `evidence_read` JSON readers
- `report_write` convenience writer for Markdown reports

No duplicate code-vs-writing file tools.

### Providers

Keep Pi native providers such as OpenAI/Codex. Add project-local provider registration for:

- DeepSeek Official API
- Xinqiong/Infini-AI OpenAI-compatible endpoint

### Skills

Use Pi's native progressive-disclosure skills. Keep one small EBM research skill initially. Web-search skills from Pi ecosystem can be integrated only if they archive sources and expose deterministic errors.

### Context and compaction

Use Pi default context handling and compaction. When compacting, save an additional JSON compaction summary inside the same session. Do not fork sessions just because context is full.

## Things intentionally removed from Python version

- SQLite store and FTS tables
- subagent manager
- scheduler/reminders/Feishu notification layer
- MEMORY.md, SOUL.md, global AGENT.md runtime manipulation
- broad MCP dependency as a default path
- duplicated tool families (`file_*`, `code_*`, task tools)
- business workflow in kernel

## Known high-risk areas to test first

- Jina URL scheme and China endpoint behavior
- MinerU API errors and large PDF timeouts
- source archive path stability
- exact quote line offsets after markdown normalization
- LLM API tool-call JSON ordering and streaming partial JSON
- context overflow and retry classification
- no silent `catch` hiding network/API errors
- provider auth env variable resolution
