#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${XUNYI_BASE_URL:-https://xunyi.siat.ac.cn}"
API_HEALTH_URL="${XUNYI_API_URL:-${BASE_URL}/ts-api/api/v1/runtime-config}"
TIMEOUT="${XUNYI_HEALTH_TIMEOUT:-5}"

status=0
check() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url") || code=000
  if [[ "$code" =~ ^(200|401|403)$ ]]; then
    printf "OK    %-12s %s\n" "$label" "$url"
  else
    printf "FAIL  %-12s %s (HTTP %s)\n" "$label" "$url" "$code"
    status=1
  fi
}

check "页面" "${BASE_URL}/"
check "API"  "${API_HEALTH_URL}"

if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -q ":8787"; then
  printf "OK    %-12s 本机 8787 端口监听中\n" "端口"
else
  printf "FAIL  %-12s 本机 8787 未监听\n" "端口"
  status=1
fi

exit "$status"