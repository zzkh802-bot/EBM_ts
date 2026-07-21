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
| Archive | `tests/archive.test.ts` | archive filenames are deterministic; metadata and body are persisted |
| Evidence | `tests/evidence.test.ts` | evidence JSON stores exact source slice and rejects traversal |
| Session | `tests/sessionStore.test.ts` | JSON session store persists messages and compaction summaries |
| Providers | `tests/providerCatalog.test.ts` | DeepSeek official and Xinqiong providers register as OpenAI-compatible Pi providers |
| Bloat boundary | `scripts/check-boundaries.ts` | no SQLite/ORM/LangChain/LlamaIndex dependency in foundation |

## Future acceptance before web product

Add tests before implementation for:

1. `web_read` returns explicit structured errors for Jina/Firecrawl/MinerU failures.
2. `web_search` archives every result set before returning model-visible summaries.
3. `evidence_add` rejects quotes that do not match archived source windows.
4. report generation fails if a citation references no evidence node.
5. provider stream tests cover partial tool-call JSON and context overflow normalization.
6. internal guideline MCP adapter returns structured errors for connect failure, timeout, and malformed tool JSON.
7. PubMed adapter uses NCBI E-utilities for search/metadata/abstract/OA-link discovery and archives returned records.
8. cloud API session isolation prevents one user reading another user's session directory when cloud work begins.
