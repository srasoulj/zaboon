#!/usr/bin/env bash
# Fails if any tracked (or staged) file contains something that looks like a secret.
# Prints FILE NAMES only, never the matching text, so a leak never lands in logs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

status=0
files=$(git ls-files -co --exclude-standard | grep -vE '^(pnpm-lock\.yaml)$' || true)

# 1. Hard patterns: OpenRouter/OpenAI-style keys, Stripe live keys, private keys.
if [ -n "$files" ]; then
  hits=$(printf '%s\n' "$files" | xargs -d '\n' grep -lIE 'sk-or-v1-[A-Za-z0-9]{16,}|sk-(proj-)?[A-Za-z0-9]{32,}|sk_live_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "secret-scan: key-like strings found in:" >&2
    printf '  %s\n' $hits >&2
    status=1
  fi
fi

# 2. detect-secrets (heuristics), when installed.
DS=$(command -v detect-secrets || true)
[ -z "$DS" ] && [ -x /opt/zaboon-tools/bin/detect-secrets ] && DS=/opt/zaboon-tools/bin/detect-secrets
if [ -n "$DS" ] && [ -n "$files" ]; then
  out=$(printf '%s\n' "$files" | xargs -d '\n' "$DS" scan --exclude-files 'pnpm-lock\.yaml' 2>/dev/null || true)
  count=$(printf '%s' "$out" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(sum(len(v) for v in d.get("results",{}).values()))
except Exception: print(0)')
  if [ "$count" != "0" ]; then
    echo "secret-scan: detect-secrets reported $count finding(s):" >&2
    printf '%s' "$out" | python3 -c 'import sys,json
d=json.load(sys.stdin)
for f,v in d.get("results",{}).items():
  for x in v: print("  %s:%s %s" % (f, x["line_number"], x["type"]))' >&2
    status=1
  fi
else
  echo "secret-scan: detect-secrets not installed; pattern scan only" >&2
fi

[ $status -eq 0 ] && echo "secret-scan: clean"
exit $status
