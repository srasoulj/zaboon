#!/bin/bash
# SessionStart hook for Claude Code on the web: makes tests, linters and the local DB work.
# Heavy work only on a fresh start; resume/compact/clear are no-ops. Idempotent.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

input="$(cat || true)"
source="$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("source","startup"))
except Exception: print("startup")' 2>/dev/null || echo startup)"
if [ "$source" != "startup" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
export DEBIAN_FRONTEND=noninteractive

# ffmpeg for the content audio pipeline (loudnorm, 0.7x clips, envelopes).
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get install -y -q ffmpeg >/dev/null 2>&1 || { apt-get update -q >/dev/null 2>&1 && apt-get install -y -q ffmpeg >/dev/null 2>&1; } || echo "session-start: ffmpeg install failed (audio pipeline only)" >&2
fi

# detect-secrets for `pnpm verify` (in a venv: Ubuntu's Python is externally managed).
if [ ! -x /opt/zaboon-tools/bin/detect-secrets ]; then
  python3 -m venv /opt/zaboon-tools >/dev/null 2>&1 && /opt/zaboon-tools/bin/pip install -q detect-secrets >/dev/null 2>&1 || echo "session-start: detect-secrets install failed" >&2
fi

# Node dependencies (non-frozen so a stale lockfile never blocks a session).
pnpm install --prefer-offline

# Local Postgres (native, no Docker): install extensions, init, start, migrate. Never resets data.
bash scripts/db-local.sh ensure || echo "session-start: local DB setup failed; run 'pnpm db:ensure'" >&2

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PATH="/opt/zaboon-tools/bin:$PATH"'
    echo 'export ZABOON_DB_PORT=54322'
  } >> "$CLAUDE_ENV_FILE"
fi
