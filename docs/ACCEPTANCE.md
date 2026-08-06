# Acceptance Criteria

Acceptance is enforced by executable tests and boundary checks, not prose-only assertions.

## Current foundation acceptance

Run:

```bash
npm run check
```

Expected:

- TypeScript strict typecheck passes.
- Vitest tests pass.
- Boundary check rejects accidental SQL/framework bloat.

## Test mapping

| Area | Test file | Invariant |
| --- | --- | --- |
| URL/Jina | `tests/urlSafety.test.ts` | metadata/private URLs rejected; Jina target preserves HTTPS |
| Archive | `tests/archive.test.ts` | normalized read sources persist under semantic `full.md`/`toc.md` directories; selected resources retain relative paths and hash manifests; output exposes bounded navigation |
| Web | `tests/web.test.ts` | suffix/Content-Type PDF detection routes Premium VLM URL → guarded download + Premium upload → Jina/Firecrawl; web search exposes only Top-K candidates and compact summaries while preserving discovery archives |
| MinerU | `tests/mineru.test.ts` | Premium VLM URL/upload polling, cancellation, ZIP Markdown extraction, and selective referenced-image retention work; failures are explicit |
| PubMed | `tests/pubmed.test.ts` | one batched retrieval produces search history plus per-abstract read archives; relevance, zero results, ELink partial failures, PMC/OpenAlex/MinerU, and abstract-only outcomes remain explicit |
| OA resolution | `tests/openAlex.test.ts` | exact PMID resolution, direct-PDF selection, bounded download, and redirect/private-address rejection |
| Evidence provenance | `tests/evidence.test.ts` | every `sources/search/` path is rejected; provenance persists; discovery-only/unverified mirrors are citation-ineligible; source windows use Pi's one-based offsets |
| EBM system identity | `tests/ebmIdentity.test.ts` | replaces only Pi's opening coding identity while preserving generated tools, guidelines, context, and skills |
| Developer trajectory | `tests/trajectory.test.ts` | Pi events produce private Markdown/JSONL traces with full finalized thinking, embedded/structured secret redaction, second-level run/model/tool timing, and no model-context injection |
| Trajectory analysis | `tests/trajectoryAnalysis.test.ts` | derives turns, repeated actions, evidence timing, tool latency/errors, thinking volume, and token/cache usage |
| Guideline MCP | `tests/guidelineMcp.test.ts` | Streamable HTTP session/SSE works; malformed JSON/timeouts are explicit; search envelopes render as semantic Markdown and read envelopes archive only titled source content |
| Vertical flow | `tests/endToEnd.test.ts` | discovery archive is rejected as evidence; an individually read source becomes exact evidence and then a source-reverified report |
| Pi resources | `tests/ebmToolsExtension.test.ts` | extension and both project skills load without diagnostics |
| Compaction | `tests/compactionArtifact.test.ts` | Pi summaries are mirrored atomically without replacing native compaction |
| Evidence | `tests/evidence.test.ts` | Markdown evidence locates and verifies continuous verbatim source quotes; traversal/symlink escape rejected |
| Reports | `tests/report.test.ts` | unknown/stale evidence blocks report writes; evidence-gap reports require explicit opt-in |
| Pi extension | `tests/ebmToolsExtension.test.ts` | project extension loads and evidence tools emit a domain event |
| Providers | `tests/providerCatalog.test.ts` | Pi owns native DeepSeek; Xinqiong registers only its OpenAI-compatible endpoint |
| Internal auth/session ownership | `tests/agentApi.test.ts`, `tests/sessionPath.test.ts` | registration/login persistence, run/citation/file ownership and user-scoped session workspaces reject cross-user access |
| Feedback/query linkage | `tests/feedback.test.ts` | all nine rubrics are required and `run_id` must match the query metadata before feedback is archived |
| Native file-tool isolation | `tests/securityGuard.test.ts` | read-only project instructions are allowed, while native writes and symlink/cross-session paths are rejected |
| Upload processing | `tests/attachmentProcessing.test.ts`, `tests/feedback.test.ts` | attachments are user/session-bound after processing, original material stays out of model context, and unsupported/cross-owner reads fail |
| Bloat boundary | `scripts/check-boundaries.ts` | no SQLite/ORM/LangChain/LlamaIndex dependency in foundation |

## Future acceptance before web product

Add tests before implementation for:

1. `web_search` adds Serper fallback when Tavily fails.
2. report generation audits citation placement/claim coverage beyond verifying referenced evidence IDs.
3. provider stream tests cover partial tool-call JSON and context overflow normalization.
4. internal guideline MCP reconnect/session-expiry behavior is covered if the server starts expiring long-lived sessions.
5. PubMed/PMC evaluation measures whether separately archived abstracts and acquired full text reduce model rounds on representative EBM questions.
6. cloud API session isolation prevents one user reading another user's session directory when cloud work begins.
7. large-PDF browser preview remains bounded by page/pixel budgets and supports a safe download fallback.
