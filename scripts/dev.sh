#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -x "$ROOT/node_modules/.bin/tsx" || ! -x "$ROOT/frontend/node_modules/.bin/vite" ]]; then
  printf '开发服务依赖不完整，请先运行 npm install 和 npm --prefix frontend install。\n' >&2
  exit 1
fi

api_pid=""
frontend_pid=""

cleanup() {
  trap - INT TERM EXIT
  [[ -n "$api_pid" ]] && kill "$api_pid" 2>/dev/null || true
  [[ -n "$frontend_pid" ]] && kill "$frontend_pid" 2>/dev/null || true
  [[ -n "$api_pid" ]] && wait "$api_pid" 2>/dev/null || true
  [[ -n "$frontend_pid" ]] && wait "$frontend_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

"$ROOT/node_modules/.bin/tsx" watch "$ROOT/scripts/api-server.ts" &
api_pid=$!
(cd "$ROOT/frontend" && "$ROOT/frontend/node_modules/.bin/vite" --host 127.0.0.1) &
frontend_pid=$!

printf '开发服务已启动：前端 http://127.0.0.1:5173，API http://127.0.0.1:8787\n'
wait -n "$api_pid" "$frontend_pid"
