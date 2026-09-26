#!/usr/bin/env bash
# The single quality gate every PR must pass (CLAUDE.md "Definition of done").
#   pnpm verify          # everything
#   pnpm verify --fast   # skip end-to-end tests and the production build
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FAST=0
for a in "$@"; do [ "$a" = "--fast" ] && FAST=1; done

failed=()
step() {
  local name="$1"; shift
  local start=$SECONDS
  echo "::group::$name"
  if "$@"; then
    echo "::endgroup::"; echo "✔ $name ($((SECONDS - start))s)"
  else
    echo "::endgroup::"; echo "✘ $name ($((SECONDS - start))s)"; failed+=("$name")
  fi
}

step "typecheck" pnpm -s typecheck
step "lint" pnpm -s lint
step "format" pnpm -s format:check
step "unit + dom tests" pnpm -s test
step "db tests" pnpm -s test:db
step "content validate" pnpm -s content validate --fixtures --allow-drafts
if [ $FAST -eq 0 ] && [ -f playwright.config.ts ]; then
  step "e2e" pnpm -s e2e
fi
if [ $FAST -eq 0 ]; then
  step "production build" bash scripts/verify-build.sh
fi
step "secret scan" bash scripts/secret-scan.sh

if [ ${#failed[@]} -gt 0 ]; then
  echo "verify FAILED: ${failed[*]}"
  exit 1
fi
echo "verify passed"
