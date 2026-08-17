#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${DP_XUNYI_TS_NODE_BIN:-node}"

if [[ -n "${DP_XUNYI_TS_ENV_FILE:-}" && -f "${DP_XUNYI_TS_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${DP_XUNYI_TS_ENV_FILE}"
  set +a
fi

exec "$NODE_BIN" "$ROOT/node_modules/tsx/dist/cli.mjs" "$ROOT/scripts/api-server.ts"
