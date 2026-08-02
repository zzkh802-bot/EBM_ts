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

### Source normalization and quote stability

Network readers can return pathological Markdown, including very long full text compressed into a single line. This harms reading and makes copied evidence text unstable.

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

### Model-visible network read contract

Read-like network tools archive the complete normalized source before model exposure. Each source uses a semantic directory containing canonical `full.md` and a generated `toc.md`; the TOC is navigation metadata, not a duplicate source. Their immediate model-visible result is navigation data plus a bounded exact preview, not the complete long document: semantic evidence path, Pi-readable full/TOC paths, total one-based line range, up to 20 Markdown heading locations, a 5KB preview, and a copyable `read(path, offset, limit)` continuation hint with an exact overlapping next offset. Every truncation must preserve a reachable path and gap-free continuation; a bounded response without a continuation mechanism is invalid. If a heading map is partial, disclose its count and point to the complete `toc.md`.

Pi's built-in `read` remains unchanged and line numbers remain useful for navigating long files. They are not evidence identifiers. The model passes a minimal, sufficient, continuous verbatim `quote` to `evidence_add`; the evidence tool locates it in the canonical archive and derives character and line coordinates for audit. It first requires a unique exact match, then permits only presentation normalization such as line wrapping, Unicode spacing, zero-width characters, and paired Markdown emphasis markers. The canonical archived quote, including its original Markdown, is always stored. Changed numbers, drug names, wording, clinical punctuation, OCR substitutions, translations, and discontinuous ellipses are never auto-accepted. When matching fails, deterministic short boundary anchors may return canonical source candidates for the model to copy and retry, but candidates are not registered automatically.

Normalize external transport artifacts before both archive and preview: decode numeric/common HTML entities, normalize Unicode spacing, remove zero-width/invalid control characters, and preserve inline PubMed XML text order. Transport envelopes such as guideline MCP JSON are not source content and must be unwrapped and rendered into semantic Markdown sections before archive. A `.md` suffix must never be used merely to rename raw JSON.

### web_read fallback order

Accepted order:

1. URL safety check.
2. PDF/document detection.
3. For recognized PDF/Office URLs: MinerU Premium VLM first when the key is configured.
4. If MinerU cannot fetch a PDF URL, securely download and upload it to MinerU Premium VLM; enforce public DNS at every redirect, a byte cap, timeout, and PDF magic validation.
5. If both MinerU PDF paths fail, use Jina and then Firecrawl as explicit degraded readers; do not add another local PDF parser without measured need.
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
   - retrieves PMID records and complete available abstracts in one batch
   - persists one reproducible `sources/search/` snapshot and one semantic `sources/read/` document per complete abstract, without extra network rounds
   - exposes each abstract's citation-capable path and `primary_abstract` provenance
   - includes similar/related article hints as discovery-only records if requested

2. `pubmed_read`
   - accepts PMID/PMCID/DOI or a search result id
   - fetches detailed metadata, abstract, PMC OA/full text when available
   - discovers OA/full-text links where possible
   - archives the fetched record/full text

Reason: split tools reduce model confusion and save tokens. The search snapshot is discovery history and can never be evidence, but a complete PubMed abstract returned by the same batch is an individually archived read source and can support claims explicitly stated in that abstract. Search output must put a compact index of every direct hit and citation-capable abstract path before long abstract bodies. Similar-article hints must include at least PMID and title, include journal/date when supplied by ESummary, and give an explicit `pubmed_read` next action. The model should not fetch full text for every search hit by default.

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

Do not add a separate EBM workflow for user-upload parsing. Use MinerU directly as the document capability. Retain `full.md` and only bounded image assets actually referenced by it, preserving relative links and a hidden hash manifest; discard unreferenced ZIP transport/layout intermediates and binary source copies. Keep the fallback chain small and trust the base model to decide when a document is worth pursuing.

PubMed abstracts are valid evidence for claims explicitly present in the abstract. Full text is preferable when methods, exact recommendations, subgroup details, or limitations matter, but lack of full text must not force endless retrieval.

### Historical data

Do not migrate old Python sessions/data. The old repo remains reference material only.

### Writing skills

Migrate writing/style skills that constrain final report/manuscript style. Do not bulk-migrate unrelated workflow/runtime skills.

### Pi system prompt adaptation

Retain Pi's generated default system prompt structure and all general-purpose tools. Do not replace it with a static `.pi/SYSTEM.md`, because that would discard dynamic tool snippets and guidelines. A project-local `before_agent_start` hook replaces only the opening coding-assistant identity with an EBM-agent identity; project context and skills provide the clinical rules. Modify vendored prompt construction only if measured behavior cannot be corrected through this native hook.

Do not require `research_frame.md`, `state.md`, or a Todo ledger. Reconsider a sparse belief checkpoint only after trajectory evidence demonstrates a continuity failure.

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

### Web runtime bridge

The Node web server uses Pi's native JSONL RPC mode rather than launching one-shot JSON-mode processes. One RPC process remains affined to each active Pi session so later turns reuse native session state; both clinician research and patient intake set thinking level through RPC before every prompt. The server keeps a bounded pool of up to eight idle session processes, evicts the least recently used process when needed, and resumes evicted sessions from Pi's persisted session directory. Cancellation and request timeouts use the RPC `abort` command, while server shutdown disposes all retained processes.

## Consequences

- The current JSON-only evidence prototype must be revised to Markdown-first.
- Text normalization becomes a core utility and must be tested before web_read implementation.
- PubMed should be implemented as `pubmed_search` + `pubmed_read`.
- Default provider configuration should be updated from `deepseek-chat` to DeepSeek V4 Flash.
