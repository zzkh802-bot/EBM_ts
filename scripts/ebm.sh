#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  printf 'EBM setup: .env is missing. Run: cp .env.example .env, then add DEEPSEEK_API_KEY.\n' >&2
fi

if [[ ! -x ./node_modules/.bin/pi ]]; then
  printf 'EBM setup: dependencies are missing. Run: npm install\n' >&2
  exit 1
fi
if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  printf 'EBM setup: DEEPSEEK_API_KEY is not configured; the default deepseek/deepseek-v4-flash model may not run. Pass --provider/--model explicitly to use another configured provider.\n' >&2
fi

export PI_SKIP_VERSION_CHECK="${PI_SKIP_VERSION_CHECK:-1}"
# Keep this demo's Pi runtime state separate from the user's global ~/.pi/agent.
# EBM_PI_AGENT_DIR is an explicit escape hatch for developers who need another sandbox.
export PI_CODING_AGENT_DIR="${EBM_PI_AGENT_DIR:-$ROOT/data/pi-agent}"
mkdir -p "$PI_CODING_AGENT_DIR" data/pi-sessions data/sessions
cp "$ROOT/.pi/models.json" "$PI_CODING_AGENT_DIR/models.json"
exec ./node_modules/.bin/pi \
  --approve \
  --session-dir "$ROOT/data/pi-sessions" \
  --no-extensions \
  --extension "$ROOT/.pi/extensions/ebm-providers.ts" \
  --extension "$ROOT/.pi/extensions/ebm-tools.ts" \
  --no-skills \
  --skill "$ROOT/.pi/skills/ebm-research/SKILL.md" \
  --skill "$ROOT/.pi/skills/clinical-report-writing/SKILL.md" \
  "$@"
