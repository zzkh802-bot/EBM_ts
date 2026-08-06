# ADR-0002: Initial product and integration choices

## Status

Accepted.

## Context

After ADR-0001 established Pi-first architecture, the project needs concrete choices for the first implementation pass. These choices should keep local development fast while preserving a path to a future cloud/web agent.

## Decisions

### 1. Pi customization style

Prefer Pi extensions and project-local Pi resources over modifying `vendor/pi-coding-agent/`.

Vendor patches are allowed only when extension/provider/resource APIs cannot satisfy a tested EBM requirement.

### 2. Product shape for now

Prioritize local development and Pi TUI usability first.

Future cloud shape is likely Node SDK in-process sessions: one logical user can open multiple isolated sessions, with session data separated by session directory. Cloud integration details will be revisited after company-side requirements are known.

### 3. Bash

Allow `bash` during local development. Do not remove Pi's native bash tool from the local TUI flow.

If/when cloud production starts, bash policy will be revisited with deployment/security constraints.

### 4. Minimal EBM retrieval/read loop

First minimal implementation order:

1. `web_read`: Jina first, with explicit structured errors and source archive.
2. PDF handling in `web_read`: detect PDF URLs and parse through a robust path before treating the page as normal HTML.
3. `web_search`: search results archived before model-visible summaries.
4. `evidence_add/list/read`: Markdown evidence source of truth plus JSON/index for UI/machine use.
5. MinerU parse for PDF/Office where configured.
6. Firecrawl fallback after Jina/local paths, especially for JS-heavy pages or Jina failures.
7. PubMed via NCBI E-utilities minimal API adapter.
8. Cochrane/guideline adapters.

Retrieval/read fallbacks must expose cost/time tradeoffs explicitly. Long fallbacks should be optional or clearly reported because they can add significant latency.

### 5. PubMed

Use NCBI E-utilities directly or via a stable library if one proves simpler and reliable.

The first adapter should remain small:

- search IDs
- fetch metadata/abstracts
- detect publication types
- discover OA/PMC/full-text links where possible
- archive fetched records

Avoid reintroducing the heavy Python PubMed design.

### 6. Evidence format

Use **Markdown evidence files as source of truth**, with JSON index/metadata as a derived or companion format.

Reason: Markdown is friendlier for the agent to inspect and reason over with Pi native `read`/`grep`, while JSON remains useful for UI and deterministic tests.

Evidence must still preserve:

- exact quote
- source path
- line range
- content hash
- relation to claim/question
- citation eligibility/status

### 7. Reports

Markdown only for v1. Word/PDF export is out of scope until the Markdown evidence/report loop is stable.

### 8. Default model/provider

Default to DeepSeek official. Keep Xinqiong as OpenAI-compatible fallback/alternative, using the already configured `.env` keys.

### 9. Pi skills ecosystem

Pi native skills are allowed, but any skill used in the EBM main research path must respect archive/provenance requirements.

Before adopting external Pi search/read skills, confirm whether they have API quota/cost implications and whether their outputs can be archived deterministically. Current quota notes are recorded in `docs/NETWORK_QUOTAS.md`.

### 10. MCP

MCP support is required because the project has an internal guideline retrieval MCP.

MCP should be added as a Pi extension/tool adapter with tests for:

- connection failure
- timeout
- tool-call JSON stability
- structured error visibility
- source archive integration

Do not make MCP the only path for guidelines; keep web/search/read fallback paths.

### 11. User/session isolation

For the original local foundation assume one local entity/user. The internal beta web deployment supersedes this scope with the lightweight account/session ownership described in ADR-0004; do not introduce a database-backed multi-tenant abstraction.

### 12. TUI

Keep Pi TUI as a first-class local development/test interface. The internal beta web UI is now an in-scope deployment surface; this does not create a second agent runtime.

## Consequences

- The next code changes should implement EBM capabilities as Pi extensions/tools, not as a parallel runtime.
- Evidence storage must shift from the current foundation's JSON-only prototype toward Markdown-first plus JSON/index.
- Retrieval tools must treat PDF handling and fallback latency as first-order design concerns.
- MCP must be planned and tested early, but as an optional adapter with fallback.
