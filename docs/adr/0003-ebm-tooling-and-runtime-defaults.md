# ADR-0003: EBM tooling and runtime defaults

## Status

Accepted.

## Context

This records detailed implementation choices for the first EBM TS tool pass. It refines ADR-0001 and ADR-0002.

## Decisions

### Evidence Markdown

Evidence source of truth is Markdown.

- Frontmatter metadata should stay close to the Python evidence metadata fields for compatibility and familiarity.
- Body should contain only readable Markdown sections.
- Do not paste redundant raw JSON at the end of the evidence file.
- JSON/index files are allowed as generated companions for UI/tests, but the agent-facing evidence record is Markdown.

### Source normalization and line stability

Network readers can return pathological Markdown, including very long full text compressed into a single line. This breaks line-offset evidence.

Therefore every read/search/document tool must normalize text **before** both:

1. archiving to files, and
2. returning the model-visible summary/hints.

The archived file and model-visible line references must use the same normalized line numbering.

Normalization goals:

- preserve content semantics
- avoid wrapping inside code fences/tables when unsafe
- split extreme one-line paragraphs into stable readable lines
- keep headings/lists readable
- produce deterministic output for identical input

### web_read fallback order

Accepted order:

1. URL safety check.
2. PDF/document detection.
3. For PDF/Office: MinerU Premium first when key is configured.
4. If remote MinerU is unstable or cannot fetch the URL, download locally and upload to MinerU Premium.
5. Local parser fallback if MinerU fails.
6. For normal web pages: Jina Reader first.
7. Firecrawl fallback for Jina failures, JS/anti-bot pages, or explicit crawl/interact needs.

Firecrawl is available but should not be first-line because it consumes account credits and can be slower.

### Search provider order

- Biomedical literature: dedicated PubMed tool first.
- General web discovery: Tavily first.
- Serper only for Google-specific operators or fallback.
- Firecrawl search only when search+scrape together has clear value or other search providers fail.

### Guideline MCP

Use the same internal guideline MCP setup as the Python project initially:

- URL/config copied from Python `config.yaml`
- search/read tool shape preserved where possible
- no assumption of safe parallelism unless tested
- failures/timeouts/malformed JSON must be explicit

### PubMed tool shape

PubMed should be split into two tools rather than one overloaded tool:

1. `pubmed_search`
   - query/search terms
   - returns PMID list, titles, abstracts/metadata when available
   - includes similar/related article hints if requested
   - archives search/summary records

2. `pubmed_read`
   - accepts PMID/PMCID/DOI or a search result id
   - fetches detailed metadata, abstract, PMC OA/full text when available
   - discovers OA/full-text links where possible
   - archives the fetched record/full text

Reason: split tools reduce model confusion and save tokens. Search is a discovery operation; read is an evidence acquisition operation. The model should not fetch full text for every search hit by default.

A convenience wrapper can be added later only if tests show models struggle with the two-step flow.

### Model default

Default model should be DeepSeek V4 Flash.

- Prefer Pi's internal/provider-native implementations where possible.
- Keep Xinqiong OpenAI-compatible configuration because current `.env` supports it and Python used it.
- Be aware DeepSeek V4 official API may differ subtly; do not hand-roll provider streaming unless Pi compatibility fails under tests.

### Bash

Do not add bash restrictions for local development at this stage. Use Pi native TUI/tooling as-is.

### Semantic model-facing filenames

Source and report filenames should be derived from titles, queries, document names, or other readable identifiers. Do not put content hashes in model-facing filenames. Keep SHA-256 values inside metadata for integrity checks. If a semantic name collides with different content, append a small numeric suffix without overwriting the earlier artifact.

Evidence IDs may remain stable machine identifiers because reports reference them directly; the evidence index supplies their claim semantics.

### Lean document handling

Do not add a separate EBM workflow for user-upload parsing. Use MinerU directly as the document capability. Keep the existing read fallback chain small and trust the base model to decide when a document is worth pursuing.

PubMed abstracts are valid evidence for claims explicitly present in the abstract. Full text is preferable when methods, exact recommendations, subgroup details, or limitations matter, but lack of full text must not force endless retrieval.

### Historical data

Do not migrate old Python sessions/data. The old repo remains reference material only.

### Writing skills

Migrate writing/style skills that constrain final report/manuscript style. Do not bulk-migrate unrelated workflow/runtime skills.

### Developer observability

Use Pi's native extension lifecycle events and persisted session JSONL instead of adding hooks to the AgentLoop. A project-local extension may write derived developer traces under the ignored session workspace.

Trajectory logs must not participate in model context: do not use `sendMessage`, custom messages, or state injection. Keep two derived views:

- Markdown for human inspection of finalized thinking, responses, tool calls/results, timing, and errors.
- JSONL for trajectory analysis, model comparison, and eval.

Pi session JSONL remains the authoritative complete conversation/tree record. Derived trajectory logs add event timing and normalized metrics, and may truncate large tool bodies while retaining archive paths. Thinking can only be recorded when the provider exposes a thinking block.

### Network tests

Real network integration tests are allowed. Keep fast unit tests, but add explicit integration test commands for Jina/MinerU/PubMed/MCP where useful.

### Startup

Use Pi native TUI directly as the main local development interface. Provide a simple documented startup command/script so testing is consistent.

## Consequences

- The current JSON-only evidence prototype must be revised to Markdown-first.
- Text normalization becomes a core utility and must be tested before web_read implementation.
- PubMed should be implemented as `pubmed_search` + `pubmed_read`.
- Default provider configuration should be updated from `deepseek-chat` to DeepSeek V4 Flash.
