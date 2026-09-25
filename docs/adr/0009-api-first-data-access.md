# ADR 0009: API-first data access, with Supabase in the browser for Auth only

- **Status:** Accepted
- **Date:** 2026-09-25
- **Amends:** [ADR 0002](0002-supabase-server-authoritative-writes.md), replacing its "Reads" bullet

## Context

ADR 0002 sent every write through a route handler but let the browser read its own rows directly,
through supabase-js and PostgREST under RLS. Implementing Phase 0 showed the cost of that split:

- **Two data paths with two security models.** Reads relied on an RLS policy being right on every table; writes were checked in handler code. Supabase grants `anon` and `authenticated` everything on new objects in `public` by default, so one missing policy or `REVOKE` exposes a table to anyone holding the publishable key, which ships in the browser.
- **Reads were written against tables.** Screens such as the stats row and the path combine several tables, so each needed several browser queries typed by generated database types, not by a contract for the screen.
- **Tests needed the whole Supabase stack.** Exercising reads meant running PostgREST, and in practice the Supabase CLI's Docker stack, which isn't available in every development environment.
- **Test content.** AI-drafted content keeps changing until it's approved, and the OpenRouter key available today has a $10 credit limit, so AI media is produced for Unit 1 first. End-to-end tests can't depend on it.

## Decision

- **One data path.** Every read and write goes through a Next.js route handler. Requests and responses are zod contracts in `packages/contracts` (`@zaboon/contracts`), shared by the handlers and the browser.
- **The browser uses Supabase only for Auth** (anonymous guests, linking, token refresh). It never queries PostgREST. Immutable content bundles and media still come straight from the Storage CDN.
- **Read endpoints:** `GET /api/home`, `/api/path`, `/api/letters`, `/api/words`, `/api/profile` and `/api/settings` (plus `PATCH /api/settings`) in the MVP; `GET /api/leaderboard` and `/api/quests` in P2. `GET /api/meta` is unchanged.
- **The database denies the browser's roles everything:**
  - The base migration revokes Supabase's default grants on schema `public` from `anon` and `authenticated`.
  - RLS stays enabled on every table, with **no policies for `anon` or `authenticated`** (deny-all).
  - Explicit policies `TO app_server` define what the server role may do. `app_server` has no `BYPASSRLS`, so a table without a policy is unreachable even from the server.
- **Ownership is enforced in code and tested:** every user-scoped repository method requires a `userId`, and every `:id` route has a cross-user (IDOR) test.
- **Auth modes** (`AUTH_MODE`):
  - **Unset or `supabase` (production):** handlers verify Supabase JWTs locally against the project's JWKS with `jose` (in place of ADR 0002's `getClaims()`), accepting only the project's asymmetric algorithm, its issuer and its `aud`.
  - **`local` (dev and test only):**
    - Dev-auth route files (`*.dev.ts`) are compiled only when a build-time flag adds them to Next's `pageExtensions`.
    - Local mode refuses to run if `VERCEL_ENV` is set or the database isn't on loopback.
    - Tokens are HS256, signed with a secret generated once per machine, and mirror Supabase's claims exactly: `role: authenticated`, `is_anonymous`, `aud`, a short `exp`, and the admin role in `app_metadata`.
    - The dev endpoints (`/api/dev/auth/*`) emulate Supabase's `identity_already_exists` error, so the link-or-merge flow runs locally.
  - CI proves that a production build rejects local tokens and returns 404 for `/api/dev/*`.
- **Local runtime without Docker:**
  - Native Postgres 16 through `scripts/db-local.sh`, with pgTAP and pg_cron from apt and the data outside the repo. CI uses the same script.
  - A local-only shim (`supabase/local/shim.sql`) mirrors Supabase's roles (`postgres` is not a superuser), the `auth` schema and the default grants, so the migrations' revokes are tested against realistic defaults.
  - Migrations keep the Supabase CLI's naming (`<timestamp>_<name>.sql`). `scripts/migrate.ts` applies them locally; production uses `supabase db push`.
- **Time seam:** handlers read the time from a `Clock`. In local mode an `x-test-now` header sets it, so tests can time-travel; production ignores the header.
- **Test content:** end-to-end tests run on a frozen fixture course (`content/fixtures`) that covers all 13 MVP challenge types, never on AI-generated content.

## Alternatives considered

- **Keep ADR 0002's direct reads under RLS.** One hop fewer for reads, but two data paths with two security models, a policy on every table that must be right for the browser's roles, and PostgREST in every test run.
- **Run the Supabase CLI's local stack (`supabase start`) in dev and CI.** The most faithful emulation, but it needs Docker, which not every development environment has. A native Postgres plus a small shim covers what the migrations and tests depend on.
- **Let the server bypass RLS** (a `BYPASSRLS` role, or the secret key for data access). Simpler, but then nothing in the database backs up the handlers. Deny-all plus explicit `app_server` policies keep RLS as a second line of defense.
- **Use a real Supabase project's Auth in dev and tests.** Every test run would need network access and secrets, and Turnstile and the per-IP limit on anonymous sign-ins get in the way of parallel end-to-end runs.

## Consequences

- **Positive:** the whole stack is testable without Docker or PostgREST: route handlers against a native Postgres, with local auth.
- **Positive:** one typed data path. Each screen gets the view it needs from a contract, in one request.
- **Positive:** a smaller attack surface. The publishable key can't read or write anything, and deny-all RLS is a backstop if a grant slips back in.
- **Negative:** an extra hop compared with PostgREST (browser → route handler → Postgres). Mitigated by region pinning: handlers set `preferredRegion` to the database's region.
- **Negative:** no Supabase Realtime. The MVP doesn't use it, and the P2 leaderboard refetches on focus and after each lesson.
- **Negative:** every screen needs an endpoint, a contract and tests, where a browser query needed only a policy.
- **Negative:** local mode is a second token issuer that must keep mirroring Supabase's claims. It's fenced off by the build-time flag, the startup checks and the CI check.
- **Follow-up:** pgTAP must prove that `anon` and `authenticated` can't read or write any table and that `app_server` has no `BYPASSRLS`. Each new `:id` route ships with its IDOR test.
