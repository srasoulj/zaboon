#!/usr/bin/env bash
# Production build check (part of the full `pnpm verify`): the web app builds in production mode
# (Supabase auth, no dev-auth routes), and none of the `*.dev.ts` routes end up in the output
# (ADR 0009). A static prerender that needs runtime configuration fails here, not on Vercel.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
env -u NEXT_PUBLIC_AUTH_MODE -u AUTH_MODE -u ZABOON_DEV_AUTH NEXT_TELEMETRY_DISABLED=1 \
  pnpm --filter @zaboon/web build
if find apps/web/.next/server/app/api/dev -type f 2>/dev/null | grep -q .; then
  echo "the production build contains dev-auth routes (apps/web/.next/server/app/api/dev)" >&2
  exit 1
fi
