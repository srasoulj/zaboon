# Zaboon: rules for every session (humans and Claude)

Zaboon is a Duolingo-style web app that teaches Persian (Farsi) to English speakers. Read the
architecture before changing anything: `docs/ARCHITECTURE.md`, `docs/DESIGN-SYSTEM.md`,
`docs/LEARNING-ENGINE.md`, `docs/adr/`. **ADR 0009 (all data through route handlers) wins over any
older text that says otherwise.**

The project is built by parallel sessions coordinated by an orchestrator session. Progress:
`docs/PROGRESS.md` and the GitHub tracking issue.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies (the SessionStart hook does this for web sessions) |
| `pnpm db:ensure` | Start/migrate the local Postgres (idempotent; never resets data). Port 54322 |
| `pnpm dev` | Local DB + Next.js dev server on :3000 |
| `pnpm verify` | **The gate**: typecheck, lint, unit+dom tests, DB tests, content validate, e2e, production build (`next build`, no dev routes), secret scan |
| `pnpm verify --fast` | Same without e2e and the production build |
| `pnpm test` / `pnpm test:db` / `pnpm e2e` | Unit+dom tests / DB tests (`*.db.test.ts`) / Playwright |
| `pnpm content <cmd>` | Content pipeline CLI (`validate`, `build`, …) |
| `pnpm ownership --base origin/main` | Checks your branch only touches paths you own |

Local DB: native Postgres 16 (no Docker), superuser `supabase_admin`, migration role `postgres`
(not a superuser, like Supabase), app role `app_server`. DB tests use
`createTestDatabase()` from `@zaboon/db/src/testing` (a private clone of `zaboon_template`).

## Architecture rules (non-negotiable)

1. **Domain packages stay framework-agnostic**: no React/Next/DOM imports in `farsi`, `grader`,
   `content-schema`, `contracts`, `session-engine`, `srs`, `game-rules` (ESLint enforces it).
2. **All data goes through route handlers** built with `withRoute(routes.<name>, …)` and typed by
   `@zaboon/contracts`. The browser never queries Postgres/PostgREST; it uses Supabase only for Auth.
3. **DB access** only via `@zaboon/db`: `withUser(db, userId, …)` for reads, `withUserLock(db, userId, …)`
   for game-state writes (one transaction, advisory lock). `withSystem` is only for cron, admin and
   account merge. RLS hides other users' rows; still always filter by `userId`, and every `:id`
   route needs a cross-user (IDOR) test.
4. **Game rules live in TypeScript** (`@zaboon/game-rules`, `@zaboon/srs`), one implementation each;
   the server is authoritative, the client only displays.
5. **Persian text**: never wrap part of a Persian word in its own element (breaks letter joining);
   set `lang="fa" dir="rtl"` explicitly; word-bank tiles are whole words; keep ZWNJ (U+200C) intact.
6. **Content is immutable and versioned**; e2e tests use the frozen `content/fixtures` course only.
7. **Auth modes**: `AUTH_MODE` unset/`supabase` in production; `AUTH_MODE=local` (dev/test) uses
   `*.dev.ts` route files compiled only when `ZABOON_DEV_AUTH=1`. Never weaken the production checks.
8. **Server framework** (`apps/web/lib/server/`): `withRoute` does auth, 426, rate limits, zod in/out
   and the error envelope; throw `ApiError(code, …)` (or the repos' `NotFoundError`/`ConflictError`),
   never build error responses by hand. Time comes from `ctx.now` (the `x-test-now` header in local
   mode), never `new Date()` in rule code. Feature flags come from `ctx.flags` (app_config, plus the
   `x-test-flags` header in local mode only). Content comes from `lib/server/content.ts` (current
   version from `content_versions`, immutable bundles cached per version).
9. **Tests against the running app**: `e2e/*.api.spec.ts` run once in the browserless `api` project;
   UI specs run in the browser projects. Get a token with `POST /api/dev/auth/anonymous` (or
   `sign-in`/`link`/`admin`). `e2e/global-setup.ts` publishes `content/fixtures` (course `fixture`)
   and `content/fa-en` to the local DB before every run; `u01-s0` is the fixture's short first lesson.
   Turn a flagged feature on with `setTestFlags(page, …)` / `flagsHeader(…)` from `e2e/fixtures`
   (DB tests: `h.call(…, { flags })` or `h.setFlags(…)`); call cron routes with `cronHeaders()`.

## Workstream protocol (parallel sessions)

- Your workstream id and owned paths are in `ops/ownership.json`. Work on branch
  `claude/zaboon-<ws-id>` and open a PR into `main` titled `[<ws-id>] …`.
- **Protected (orchestrator-owned) paths are read-only for you**: contracts, content-schema,
  tokens.json, oracles, fixtures, content/, CI, configs, scripts, CLAUDE.md, shared app files. CI
  rejects edits (`pnpm ownership`). If you need a contract change, keep working with an adapter
  on your side and add a `## Contract change request` section to your PR; the orchestrator does it.
- **Stubs and oracles**: each domain package exports `IMPLEMENTATION = 'stub' | 'real'`. Oracle tests
  (`**/oracles/*.yaml`, read-only) run only when it is `'real'`. Flip it to `'real'` in your PR;
  every oracle case must pass. Contract tests (`*.contract.test.ts`) must pass throughout.
- **Never wait for input.** Nobody will answer questions. Make the best decision, record it under
  `## Decisions` in the PR body, and continue.
- **Definition of done**: `pnpm verify` green locally; new behavior has tests; no `.skip`/`.only`/
  `fixme`; no deleted assertions; PR body has `## Summary`, `## Decisions`, `## Tests`,
  `## Contract change request` (or "none"). Then post a PR comment `STATUS: READY` (or
  `STATUS: BLOCKED: <reason>` after trying your best).
- Before the final push: `git fetch origin main && git merge origin/main`. On a `pnpm-lock.yaml`
  conflict, take main's version (`git checkout --theirs pnpm-lock.yaml`), run `pnpm install`,
  commit. Add dependencies only when necessary and only to your own packages.
- Never push to `main`, never force-push shared branches, never rewrite others' history.
- **GitHub Actions is unavailable for now** (runners never start for this account), so CI is
  manual-only. `pnpm verify` is the gate: run it before every push and paste the ✔/✘ summary into the
  PR. Do not try to fix or re-run CI. The orchestrator re-runs `pnpm verify` on the merge commit.

## Secrets and AI

- Never commit secrets. `.env.example` lists names only. `pnpm secrets:scan` must stay clean.
- All AI goes through OpenRouter via `@zaboon/ai` (ADR 0008). Build key `OPENROUTER_API_KEY_BUILD`
  (content pipeline only), app key `OPENROUTER_API_KEY_APP` (server only). Worker sessions have no
  keys: use `MockTransport` in tests. Models are pinned in `packages/ai/ai.models.yaml`.

## Version notes (verified 2026-09)

- Next.js 16.3 (App Router): `proxy.ts` replaces `middleware.ts`; Turbopack is the default bundler;
  PWA via `@serwist/turbopack`. React 19.3. Tailwind v4 (`@source` must include `packages/ui`).
- TypeScript **6.0** (not 7: typescript-eslint supports < 6.1). zod 4 (`z.iso.datetime()`).
- Vitest 5 with `projects`: `unit` (`*.test.ts`), `dom` (`*.test.tsx`, jsdom), `db` (`*.db.test.ts`).
- Playwright **1.56.1** matches the preinstalled Chromium (build 1194). **Never run
  `playwright install` locally**; CI installs Chromium + WebKit.
- pnpm 10: dependency build scripts need `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
