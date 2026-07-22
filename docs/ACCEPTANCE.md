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
| Archive | `tests/archive.test.ts` | full normalized read sources persist under semantic `full.md`/`toc.md` directories; output exposes a 5KB preview, one-based heading map, readable paths, and continuation hint |
| Web | `tests/web.test.ts` | MinerU/Jina/Firecrawl routing is ordered; Tavily/Jina/MinerU results are normalized and archived before exposure |
| MinerU | `tests/mineru.test.ts` | Premium task polling and ZIP Markdown extraction succeed; task/ZIP failures are explicit |
| PubMed | `tests/pubmed.test.ts` | search uses relevance ordering, marks zero-result snapshots, preserves mixed inline XML text, batches abstracts/related hints; read accepts labeled identifiers and uses bounded full-text fallback |
| OA resolution | `tests/openAlex.test.ts` | exact PMID resolution, direct-PDF selection, bounded download, and redirect/private-address rejection |
| Evidence provenance | `tests/evidence.test.ts` | provenance persists; discovery-only and unverified mirrors are citation-ineligible; source windows use the same one-based offsets as Pi read |
| EBM system identity | `tests/ebmIdentity.test.ts` | replaces only Pi's opening coding identity while preserving generated tools, guidelines, context, and skills |
| Developer trajectory | `tests/trajectory.test.ts` | Pi events produce private Markdown/JSONL traces with full finalized thinking, embedded/structured secret redaction, second-level run/model/tool timing, and no model-context injection |
| Trajectory analysis | `tests/trajectoryAnalysis.test.ts` | derives turns, repeated actions, evidence timing, tool latency/errors, thinking volume, and token/cache usage |
| Guideline MCP | `tests/guidelineMcp.test.ts` | Streamable HTTP session/SSE works; malformed JSON/timeouts are explicit; search envelopes render as semantic Markdown and read envelopes archive only titled source content |
| Vertical flow | `tests/endToEnd.test.ts` | discovery archive becomes exact evidence and then a source-reverified report |
| Pi resources | `tests/ebmToolsExtension.test.ts` | extension and both project skills load without diagnostics |
| Compaction | `tests/compactionArtifact.test.ts` | Pi summaries are mirrored atomically without replacing native compaction |
| Evidence | `tests/evidence.test.ts` | Markdown evidence stores and verifies exact source slices; traversal/symlink escape rejected |
| Reports | `tests/report.test.ts` | unknown/stale evidence blocks report writes; evidence-gap reports require explicit opt-in |
| Session | `tests/sessionStore.test.ts` | JSON session store persists messages and compaction summaries |
| Pi extension | `tests/ebmToolsExtension.test.ts` | project extension loads and evidence tools emit a domain event |
| Providers | `tests/providerCatalog.test.ts` | Pi owns native DeepSeek; Xinqiong registers only its OpenAI-compatible endpoint |
| Bloat boundary | `scripts/check-boundaries.ts` | no SQLite/ORM/LangChain/LlamaIndex dependency in foundation |

## Future acceptance before web product

Add tests before implementation for:

1. `web_read` verifies redirect/DNS targets remain public and adds local download/upload when MinerU cannot fetch a remote PDF.
2. `web_search` adds Serper fallback when Tavily fails.
3. `evidence_add` archives only exact source windows and `evidence_read` reports later source/hash mismatches.
4. report generation audits citation placement/claim coverage beyond verifying referenced evidence IDs.
5. provider stream tests cover partial tool-call JSON and context overflow normalization.
6. internal guideline MCP reconnect/session-expiry behavior is covered if the server starts expiring long-lived sessions.
7. PubMed/PMC evaluation measures whether batched abstracts and full text reduce model rounds on representative EBM questions.
8. source normalization turns pathological one-line reader output into deterministic multi-line Markdown before archive and model-visible line hints.
9. cloud API session isolation prevents one user reading another user's session directory when cloud work begins.
