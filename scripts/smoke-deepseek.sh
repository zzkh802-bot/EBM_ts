#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a
# shellcheck disable=SC1091
source .env
set +a

[[ -n "${DEEPSEEK_API_KEY:-}" ]] || { echo "✗ DEEPSEEK_API_KEY is missing" >&2; exit 1; }
echo "proxy: HTTP_PROXY=$([[ -n "${HTTP_PROXY:-}" ]] && echo configured || echo unset), HTTPS_PROXY=$([[ -n "${HTTPS_PROXY:-}" ]] && echo configured || echo unset)"

http_code="$(curl --silent --show-error --connect-timeout 10 --max-time 20 \
  --output /dev/null --write-out '%{http_code}' https://api.deepseek.com/models)" || {
  status=$?
  echo "✗ DeepSeek endpoint connectivity failed (curl exit $status)" >&2
  exit "$status"
}
echo "endpoint: reachable (HTTP $http_code; authentication is tested next)"

stderr_file="$(mktemp)"
trap 'rm -f "$stderr_file"' EXIT
set +e
response="$(PI_SKIP_VERSION_CHECK=1 timeout --signal=TERM 90 ./node_modules/.bin/pi \
  --approve --no-session \
  --provider deepseek --model deepseek-v4-flash --thinking off \
  -p 'Reply with exactly: DEEPSEEK_OFF_OK' 2>"$stderr_file")"
status=$?
set -e
if [[ $status -ne 0 ]]; then
  echo "✗ Pi/DeepSeek request failed (exit $status)" >&2
  if [[ $status -eq 124 ]]; then echo "  request exceeded 90 seconds" >&2; fi
  [[ ! -s "$stderr_file" ]] || { echo "--- provider stderr ---" >&2; head -80 "$stderr_file" >&2; }
  exit "$status"
fi
if [[ "$response" != "DEEPSEEK_OFF_OK" ]]; then
  printf '✗ Unexpected response: %s\n' "$response" >&2
  exit 1
fi
printf '✓ DeepSeek V4 Flash basic response\n'
