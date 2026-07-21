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
| Evidence | `tests/evidence.test.ts` | Markdown evidence stores and verifies exact source slices; traversal/symlink escape rejected |
| Session | `tests/sessionStore.test.ts` | JSON session store persists messages and compaction summaries |
| Pi extension | `tests/ebmToolsExtension.test.ts` | project extension loads and evidence tools emit a domain event |
| Providers | `tests/providerCatalog.test.ts` | Pi owns native DeepSeek; Xinqiong registers only its OpenAI-compatible endpoint |
| Bloat boundary | `scripts/check-boundaries.ts` | no SQLite/ORM/LangChain/LlamaIndex dependency in foundation |

## Future acceptance before web product

Add tests before implementation for:

1. `web_read` returns explicit structured errors for Jina/Firecrawl/MinerU failures.
2. `web_search` archives every result set before returning model-visible summaries.
3. `evidence_add` archives only exact source windows and `evidence_read` reports later source/hash mismatches.
4. report generation fails if a citation references no evidence node.
5. provider stream tests cover partial tool-call JSON and context overflow normalization.
6. internal guideline MCP adapter returns structured errors for connect failure, timeout, and malformed tool JSON.
7. PubMed adapters use NCBI E-utilities: `pubmed_search` for discovery/abstract/similar hints and `pubmed_read` for detail/OA/full-text acquisition; both archive returned records.
8. source normalization turns pathological one-line reader output into deterministic multi-line Markdown before archive and model-visible line hints.
9. cloud API session isolation prevents one user reading another user's session directory when cloud work begins.
