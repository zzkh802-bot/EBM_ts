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
| Archive | `tests/archive.test.ts` | archive filenames are deterministic; body offsets map model excerpts to stored files |
| Web | `tests/web.test.ts` | Jina/Firecrawl failures are explicit; Tavily/Jina results are normalized and archived before exposure |
| PubMed | `tests/pubmed.test.ts` | ESearch/ESummary/EFetch outputs are archived; transient failures retry; API keys never enter archives |
| Evidence | `tests/evidence.test.ts` | Markdown evidence stores and verifies exact source slices; traversal/symlink escape rejected |
| Reports | `tests/report.test.ts` | unknown/stale evidence blocks report writes; evidence-gap reports require explicit opt-in |
| Session | `tests/sessionStore.test.ts` | JSON session store persists messages and compaction summaries |
| Pi extension | `tests/ebmToolsExtension.test.ts` | project extension loads and evidence tools emit a domain event |
| Providers | `tests/providerCatalog.test.ts` | Pi owns native DeepSeek; Xinqiong registers only its OpenAI-compatible endpoint |
| Bloat boundary | `scripts/check-boundaries.ts` | no SQLite/ORM/LangChain/LlamaIndex dependency in foundation |

## Future acceptance before web product

Add tests before implementation for:

1. `web_read` adds MinerU/document detection and verifies redirect/DNS targets remain public.
2. `web_search` adds Serper fallback when Tavily fails.
3. `evidence_add` archives only exact source windows and `evidence_read` reports later source/hash mismatches.
4. report generation audits citation placement/claim coverage beyond verifying referenced evidence IDs.
5. provider stream tests cover partial tool-call JSON and context overflow normalization.
6. internal guideline MCP adapter returns structured errors for connect failure, timeout, and malformed tool JSON.
7. `pubmed_read` appends PMC open-access full text when available instead of returning only a full-text warning.
8. source normalization turns pathological one-line reader output into deterministic multi-line Markdown before archive and model-visible line hints.
9. cloud API session isolation prevents one user reading another user's session directory when cloud work begins.
