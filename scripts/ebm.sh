#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export PI_SKIP_VERSION_CHECK="${PI_SKIP_VERSION_CHECK:-1}"
mkdir -p data/pi-sessions data/sessions
exec ./node_modules/.bin/pi --approve --session-dir "$ROOT/data/pi-sessions" "$@"
