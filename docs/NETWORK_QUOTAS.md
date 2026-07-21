# Network search/read quota notes

Last checked: 2026-07-21.

## Pi skills and quota model

Pi itself does **not** provide a native web-search quota. Pi skills are Markdown/scripts that call external providers. Quota/cost depends on the backend used by each skill/tool.

Therefore EBM TS must treat every network retrieval adapter as provider-specific:

- expose provider name in tool output
- expose skipped/error/fallback chain explicitly
- archive outputs before citation
- avoid duplicate scrape/read calls when search already hydrated content
- keep expensive/slow fallbacks optional or clearly reported

## Locally installed web/search skills

Currently discovered relevant local skills are primarily Firecrawl-based:

- `firecrawl-search`
- `firecrawl-scrape`
- `firecrawl-crawl`
- `firecrawl-map`
- `firecrawl-interact`
- `firecrawl-agent`
- related Firecrawl build/onboarding skills

No local `brave-search` Pi skill was found in `~/.pi/agent/skills` or `~/.agents/skills` at check time.

## Firecrawl quota

Verified with:

```bash
firecrawl --status
firecrawl credit-usage --json --pretty
```

Current result:

```json
{
  "remainingCredits": 764,
  "planCredits": 1000,
  "billingPeriodStart": "2026-06-22T15:02:40.630Z",
  "billingPeriodEnd": "2026-07-22T15:02:40.630Z"
}
```

CLI also reports parallel scrape concurrency:

```text
Concurrency: 0/2 jobs (parallel scrape limit)
Credits: 764 / 1,000 (76% left this cycle)
```

Implication for EBM TS:

- Firecrawl is usable as fallback, but not as first-line for every read if Jina/local/PubMed can work.
- `search --scrape` should be used carefully: it can save duplicate calls when needed, but costs more than plain search.
- Firecrawl fallback should record credit-sensitive behavior in returned metadata.

## Jina Reader

Jina Reader is configured and reachable in the Python repo environment as of the prior check. No local CLI quota/status command was found. Treat Jina quota/rate limits as provider-plan dependent and surface HTTP 429/rate-limit errors without silent fallback.

EBM TS already has a test that Jina Reader URL construction preserves HTTPS scheme.

## Tavily / Serper

Tavily and Serper are API-backed search providers. No local quota check was performed here; usage should be verified in their dashboards or through provider APIs before making them default high-volume tools.

## PubMed / NCBI

PubMed E-utilities should be the preferred biomedical literature path where possible because it avoids generic web-search quota burn.

Known NCBI E-utilities policy:

- without `NCBI_API_KEY`: lower rate limit, commonly 3 requests/second
- with `NCBI_API_KEY`: higher rate limit, commonly 10 requests/second
- include `NCBI_EMAIL` when available

## Design consequence

Default retrieval order should minimize quota burn:

1. Purpose-built biomedical APIs first when applicable, e.g. PubMed E-utilities.
2. Jina Reader for known URLs / normal web pages.
3. Local PDF parsing or MinerU for PDFs/documents when configured.
4. Firecrawl only when JS rendering, interaction, crawling, or Jina/local parsing fails.
5. Generic search APIs only for discovery, not repeated reading of already-known URLs.
