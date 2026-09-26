# Zaboon deployment runbook

> Derived from the repository at `e68ae3a` (main, 2026-09-26): code, `docs/`, `.env.example`,
> `docs/PROGRESS.md` and PR #34. Paths are relative to the repo root. **Owner:** marks something
> the code does not settle (a decision or a check for the project owner). Names only, never values.

**First deploy, in order:** Supabase Auth (§3.1) → migrations, `app_server` password, checks (§3.2)
→ `content` bucket (§3.3) → publish `fa-en` and make it current (§4) → Vercel settings and
variables, deploy (§5) → smoke test (§7) → feature flags when wanted (§6).

## 1. Overview

| Piece | Where | Notes |
|---|---|---|
| Web app + API | Vercel project `zaboon` (team `srasouljs-projects`), Root Directory `apps/web` (PR #34, Vercel bot comment; docs/PROGRESS.md) | One Next.js 16 app: marketing pages, the client-rendered learner app and the route handlers in `apps/web/app/api` (docs/adr/0001, docs/adr/0009) |
| Postgres | Supabase | Handlers connect as `app_server` (no superuser, no BYPASSRLS) through the Supavisor transaction pooler (docs/ARCHITECTURE.md §9) |
| Auth | Supabase Auth | The browser uses supabase-js for Auth only; the server verifies JWTs locally against the project's JWKS (apps/web/lib/server/auth/supabase.ts) |
| Content | Supabase Storage bucket `content` (public) | Immutable `fa-en/v<N>/` bundles plus hashed `fa-en/assets/` (tools/content-cli/src/build.ts); the current version is a row in `content_versions` (docs/adr/0005) |
| Scheduled jobs | pg_cron (pure SQL) and Vercel Cron (Node) | docs/ARCHITECTURE.md §8 |
| AI | OpenRouter | The app's only AI call is speech transcription for the `speak` flag (`POST /api/speech/transcribe`, `OPENROUTER_API_KEY_APP`, model `app_transcribe`; apps/web/lib/server/speech/transcriber.ts). With the flag off it makes none |

There is no `apps/web/proxy.ts` (or middleware): every API route authenticates, rate-limits and
validates itself through `withRoute` (apps/web/lib/server/with-route.ts).

## 2. Accounts and prerequisites

- **Accounts** (docs/PROGRESS.md, human backlog): needed now are Supabase, Vercel, a domain and an
  SMTP provider. Stripe, Turnstile, Sentry and Amplitude are not wired into the code yet (§9).
- **Owner:** plans. The docs assume Supabase Pro (+ custom-domain add-on) and Vercel Pro
  (docs/ARCHITECTURE.md §13). Vercel Hobby is enough for today's single weekly cron (§5.4).
- **Owner:** a second Supabase project as **staging** for Vercel previews (docs/ARCHITECTURE.md
  §13). Without one, preview deployments have no backend.
- **Owner:** one region for the database and the Vercel functions. The docs want handlers next to
  the database (`preferredRegion`, docs/ARCHITECTURE.md §3.1 rule 5), but no route sets it, so
  choose the region in the Vercel project settings.
- Operator machine: Node ≥ 22.12 (`engines` in package.json, `.nvmrc`), pnpm 10.33.0
  (`packageManager`), the Supabase CLI and `psql`. Run `pnpm install` at the repo root.
- Gate: `pnpm verify` green on the exact commit you deploy, including the production build without
  dev routes (CLAUDE.md; scripts/verify-build.sh). CI is manual-only (.github/workflows/ci.yml).

## 3. Supabase

### 3.1 Auth

| Setting | Value | Why (source) |
|---|---|---|
| Anonymous sign-ins | **On** | Every first-time visitor of an app page is signed in as a guest (`useEnsureGuest`, apps/web/lib/app-services.tsx; `signInAnonymously`, apps/web/lib/auth-client.ts) |
| Anonymous sign-in rate limit | Raise the per-IP default | Mobile carriers put many users behind one IP (docs/ARCHITECTURE.md §9). **Owner:** the value |
| CAPTCHA protection | **Off for now** | The docs want Turnstile on guest sign-in (§9), but `signInAnonymously()` sends no captcha token and no code reads the Turnstile keys. Turning it on breaks guest sign-in |
| JWT signing keys | **Asymmetric: ES256 or RS256** | The server accepts only ES256/RS256 keys from `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/.well-known/jwks.json`, with issuer `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1` and audience `authenticated` (apps/web/lib/server/auth/supabase.ts). `role` must be `authenticated` and `sub` a UUID (auth/claims.ts). Tokens signed with a legacy shared secret get 401 everywhere |
| Site URL | The production origin (= `NEXT_PUBLIC_SITE_URL`) | `linkEmail` calls `updateUser({ email })` without a redirect, so that email link returns to the Site URL (auth-client.ts) |
| Redirect URLs | `https://<domain>/learn` | Email sign-in sets `emailRedirectTo: <origin>/learn` (auth-client.ts). In the staging project, allow the preview hosts, `zaboon-git-<branch>-srasouljs-projects.vercel.app` (PR #34, Vercel bot; docs/ARCHITECTURE.md §13) |
| Email and custom SMTP | Required before real users | Sign-in and "create a profile" send email links (auth-client.ts). Supabase's default mailer only sends to project team members (docs/ARCHITECTURE.md §12). The SMTP credentials go into Supabase, not Vercel. **Owner:** provider (the docs suggest Resend) and sender domain |
| Manual identity linking | On | Required for `linkIdentity` (docs/ARCHITECTURE.md §12). Today's client links email only, via `updateUser`, so it matters once Google/Apple land |
| Google / Apple | Optional, later | Not wired: no OAuth or `linkIdentity` call and no PKCE callback (auth-client.ts). PKCE is on the hardening backlog (docs/PROGRESS.md) |
| Custom auth domain | Optional (docs/ARCHITECTURE.md §12) | **Owner:** if `NEXT_PUBLIC_SUPABASE_URL` points at it, check that a token's `iss` equals `<that URL>/auth/v1`, or every API call returns 401 (auth/supabase.ts) |

Check: `curl -s https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` lists a key with
`"alg":"ES256"` or `"RS256"`.

**Admins** (report triage at `/admin`) are users whose `app_metadata.role` is `"admin"`
(apps/web/lib/server/auth/claims.ts). For example:
`UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' WHERE email = '<admin email>';`
(the local emulation writes the same field, auth/dev-users.ts). The admin then signs in again.

### 3.2 Database

Migrations run as **`postgres`**, the non-superuser role that owns the tables: one transaction per
file, recorded in `supabase_migrations.schema_migrations`. Production uses `supabase db push`;
scripts/migrate.ts mirrors it locally (docs/adr/0009). Don't mix roles: pg_cron runs each job as the
role that scheduled it, and only the owner may execute `internal.*`
(20260925000400_housekeeping.sql). Never apply `supabase/local/shim.sql` (a local emulation of
Supabase's roles, `auth` schema and extensions), and don't install pgTAP: the `supabase/tests/`
suites run locally only (packages/db/src/pgtap.db.test.ts).

1. Enable **pg_cron** under Database → Extensions first (packages/db/README.md).
2. Push with `supabase db push` as `postgres`, and watch for `WARNING: zaboon: …` lines. **Owner:**
   the repo has no `supabase/config.toml`. If the CLI needs one, create it outside the repo, or
   apply the files with `psql` as `postgres` in filename order, one transaction each, recording each
   in `supabase_migrations.schema_migrations (version, name, statements)` like scripts/migrate.ts.

| File (supabase/migrations/) | What it does |
|---|---|
| `20260925000000_base.sql` | Revokes Supabase's default grants from `anon`/`authenticated`; creates `app_server` (`LOGIN NOINHERIT`, no password); schemas `internal` and `rls` |
| `20260925000100_core.sql` | Core tables, RLS helpers, deny-all RLS plus `TO app_server` policies |
| `20260925000200_mvp_tables.sql` | Remaining MVP tables; trigger `zaboon_on_auth_user_created` on `auth.users` creates profiles |
| `20260925000300_p2_tables.sql` | Coins, leagues, quests, entitlements, webhooks, push (idle until their flags are on) |
| `20260925000400_housekeeping.sql` | `internal.*` housekeeping functions |
| `20260925000500_function_privileges.sql` | No implicit `PUBLIC` execute on functions |
| `20260925000600_pg_cron_schedules.sql` | Installs pg_cron when it can and (re)schedules 5 jobs; otherwise a `WARNING` |
| `20260925000700_app_server_timeouts.sql` | `app_server`: lock 10 s, idle in transaction 60 s, statement 15 s |
| `20260926000000_engagement.sql` | League-week shape, engagement policies, 10 `quest_defs` rows |

3. Set the `app_server` password out of band, never in git (base migration). `postgres` created
   the role, so it may alter it (20260925000700_app_server_timeouts.sql). Use `\password app_server`
   in `psql` as `postgres` to keep it out of query history, or
   `ALTER ROLE app_server WITH PASSWORD '<generated>';`.
4. Build `DATABASE_URL_APP_SERVER` from the **transaction pooler** with the `app_server` user and
   password (.env.example). Prepared statements are off for it (packages/db/src/index.ts).
   **Owner:** copy the host, port and user-name format from the dashboard's transaction-pooler
   string, and decide on TLS (for example `sslmode=require`): the URL goes to postgres.js as is.
5. Verify in the SQL editor (adapted from supabase/tests/001–002):

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;  -- 9 rows
SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
FROM pg_roles WHERE rolname = 'app_server';                                        -- t f f f f
SELECT unnest(s.setconfig) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
WHERE r.rolname = 'app_server' AND s.setdatabase = 0;                              -- the 3 timeouts
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;  -- no rows
SELECT r.rolname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (rolname)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  AND has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE');     -- no rows
SELECT tgname FROM pg_trigger WHERE tgname = 'zaboon_on_auth_user_created';        -- 1 row
SELECT count(*) FROM public.quest_defs;                                            -- 10
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'zaboon-%' ORDER BY jobname;
```

The last query must list five active jobs (UTC, 20260925000600_pg_cron_schedules.sql):
`zaboon-expire-stale-sessions` `*/15 * * * *`, `zaboon-prune-rate-limits` `20 * * * *`,
`zaboon-prune-session-answers` `40 3 * * *`, `zaboon-prune-webhook-events` `50 3 * * *` and
`zaboon-rollup-item-stats` `10 3 * * *`. If none are listed, enable pg_cron and re-run that
migration's `DO` block in the SQL editor as `postgres` (packages/db/README.md).

6. **Owner (optional hardening):** the app never uses PostgREST (docs/adr/0009). The migrations
   revoke `anon`/`authenticated` only, so `service_role` keeps Supabase's default grants (mirrored
   in supabase/local/shim.sql): treat `SUPABASE_SECRET_KEY` as full data access, and consider
   turning the Data API off.
7. **Owner:** backups or point-in-time recovery before the first push. Migrations are forward-only.

### 3.3 Storage

- Create the bucket **`content`** (the CLI's default `--bucket`, tools/content-cli/src/program.ts)
  as **public**. Its public URL is `CONTENT_BASE_URL`:
  `https://<ref>.supabase.co/storage/v1/object/public/content` (.env.example). It must be `https`:
  the browser plays audio only from its own `/content/` or from under that base
  (apps/web/components/path/play-audio.ts).
- The CLI creates objects with `Cache-Control: public, max-age=31536000, immutable` and
  `x-upsert: false`, and never overwrites them (tools/content-cli/src/storage.ts). If you restrict
  MIME types, allow `application/json`, `audio/mpeg`, `audio/mp4`, `image/webp`, `image/png`,
  `image/svg+xml` and `application/octet-stream` (same file).
- `select_image` pictures load with `crossOrigin="anonymous"`
  (apps/web/components/challenges/SelectImage.tsx), so the bucket must send CORS headers (§7).

## 4. Content publishing

Only `content/fa-en` (course `fa-en`, the app's `DEFAULT_COURSE_ID`,
packages/contracts/src/schemas.ts) goes to production. **Never publish `content/fixtures`** (course
`fixture`): it is the frozen e2e course, published only to the local database (e2e/global-setup.ts;
CLAUDE.md rule 6), and the API plays any course with a current version (`courseId` in
`POST /api/sessions`, apps/web/lib/server/sessions.ts). `publish --local` is for dev only
(tools/content-cli/src/publish.ts).

**Owner decision: drafts.** Every item in `content/fa-en` is `status: draft`
(content/fa-en/course.yaml; docs/PROGRESS.md), so a strict build fails with "only approved items can
be published" (tools/content-cli/src/validate.ts). `--allow-drafts` publishes them and records
`includes_drafts = true`; the docs say nothing AI-generated ships without human approval
(docs/ARCHITECTURE.md §11.3).

Run on a trusted machine or in content CI, never on Vercel (.env.example):

```bash
export SUPABASE_URL=https://<ref>.supabase.co   # read by tools/content-cli/src/storage.ts
export CONTENT_STORAGE_UPLOAD_KEY=…             # from your secret store; write access to the bucket
pnpm content validate --course fa-en            # strict: fails while items are drafts
pnpm content build --course fa-en --version <N> [--allow-drafts]   # optional: inspect .local/content-build/fa-en/v<N>/
pnpm content publish --target storage --course fa-en --version <N> [--allow-drafts]
```

- `<N>` = `SELECT coalesce(max(version), 0) + 1 FROM public.content_versions WHERE course_id = 'fa-en';`.
  `publish` builds by itself and refuses a version whose `manifest.json` already exists.
- Upload order: hashed assets (skipped when present), then the `fa-en/v<N>/` files, `manifest.json`
  last. A failed run leaves a partial `v<N>/`: delete it from the bucket or pick a new `<N>`
  (tools/content-cli/src/storage.ts).
- **Owner:** which credential `CONTENT_STORAGE_UPLOAD_KEY` is. The CLI sends it as `apikey` and as
  `Authorization: Bearer` to the Storage REST API (storage.ts). `.env.example` lacks `SUPABASE_URL`.

**Register, then make current** (a separate, approved step, docs/LEARNING-ENGINE.md §4.4): run the
INSERT the CLI prints (storage.ts), then the switch that `setCurrentContentVersion` performs
(packages/db/src/repos/content.ts):

```sql
INSERT INTO public.content_versions (course_id, version, bundle_path, includes_drafts, is_current)
VALUES ('fa-en', <N>, 'fa-en/v<N>', <true|false>, false);

BEGIN;
UPDATE public.content_versions SET is_current = false WHERE course_id = 'fa-en' AND is_current;
UPDATE public.content_versions SET is_current = true  WHERE course_id = 'fa-en' AND version = <N>;
COMMIT;
```

A course has at most one current version (unique index `content_versions_one_current`,
20260925000100_core.sql). Servers cache the pointer for about 10 s (apps/web/lib/server/content.ts);
then `GET /api/meta` reports `contentVersion: <N>`. Sessions keep the version they started on, and
enrollments move forward through `pathMigrations` (docs/adr/0005). The row's `min_app_version` is
unused: `/api/meta` reads `minAppVersion` from `app_config` (apps/web/app/api/meta/route.ts).

**Rollback:** republish the previous content as **v\<N+1\>**; never move the pointer backwards past
a path migration (docs/adr/0005; docs/LEARNING-ENGINE.md §4.4). Build the old source with the
current CLI, since `--course` accepts a directory (tools/content-cli/src/paths.ts), then register
`<N+1>` and make it current as above:

```bash
mkdir -p /tmp/fa-en-rollback
git archive <last-good-sha> content/fa-en | tar -x -C /tmp/fa-en-rollback
pnpm content publish --target storage --course /tmp/fa-en-rollback/content/fa-en --version <N+1> [--allow-drafts]
```

## 5. Vercel

### 5.1 Project and build

- Root Directory **`apps/web`** (docs/PROGRESS.md; apps/web/vercel.test.ts), framework Next.js.
- Build command: the package's `next build` (apps/web/package.json). **Owner, verify:** the build
  log must show `next build`, not `turbo run build`. turbo.json declares no `env`, and Turborepo's
  strict environment mode could hide `CONTENT_BASE_URL` from the build; audio would then be refused
  without an error (the failure #42 fixed, docs/PROGRESS.md). §7 has a check.
- Install: pnpm 10.33.0 from `packageManager` (package.json). `onlyBuiltDependencies` lets esbuild
  install; the service-worker route bundles with it (pnpm-workspace.yaml;
  apps/web/app/serwist/[path]/route.ts).
- Node.js **22.x** (`engines: >=22.12` in package.json, `.nvmrc`). apps/web/package.json has no
  `engines`, so set the version in the project.
- The build needs the whole repository: the app compiles workspace packages from `packages/*`
  (`transpilePackages` in apps/web/next.config.ts). Keep files outside the Root Directory included.
- Functions region: §2. Production uses the production Supabase project, Preview the staging one
  (docs/ARCHITECTURE.md §13).

### 5.2 Environment variables

The required set matches PR #34's list. Set each variable for Production and for Preview.

| Variable | When | Required | Read in | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build + runtime | yes | apps/web/lib/auth-client.ts, apps/web/lib/server/env.ts | Browser auth; server JWKS and issuer (auth/supabase.ts) and the Admin API (auth/admin.ts). Missing: every API route answers 500 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build | yes | apps/web/lib/auth-client.ts | Inlined into the browser; used for Auth only |
| `NEXT_PUBLIC_SITE_URL` | build | yes | apps/web/app/layout.tsx, robots.ts, sitemap.ts | Canonical origin; falls back to `http://localhost:3000` |
| `CONTENT_BASE_URL` | build + runtime | yes | apps/web/next.config.ts, apps/web/app/serwist/[path]/route.ts, apps/web/lib/server/env.ts, content.ts | The bucket URL from §3.3. Build: inlined as `NEXT_PUBLIC_CONTENT_BASE_URL` (don't set that name yourself) and into the service worker. Runtime: bundle fetches and media URLs. Unset: the server reads `apps/web/public/content`, which is not deployed (PR #34) |
| `DATABASE_URL_APP_SERVER` | runtime | yes | apps/web/lib/server/env.ts | §3.2 step 4. Missing: every API route answers 500. Each server instance opens up to 10 connections (apps/web/lib/server/db.ts) |
| `SUPABASE_SECRET_KEY` | runtime | yes | apps/web/lib/server/auth/admin.ts | Admin API user deletion for `DELETE /api/account` and guest merges (apps/web/lib/server/account.ts). Server only |
| `CRON_SECRET` | runtime | yes | apps/web/lib/server/env.ts, auth/cron.ts | Without it the cron route answers 401 to every call |
| `OPENROUTER_API_KEY_APP` | runtime | for `speak` | apps/web/lib/server/speech/transcriber.ts | Runtime AI, with its own credit limit set on the key in OpenRouter (docs/adr/0008). Missing: `POST /api/speech/transcribe` answers 503 without spending quota |
| `APP_SIGNING_SECRET` | runtime | for `speak` | apps/web/lib/server/signing.ts | At least 32 random characters (`openssl rand -base64 48`). Signs speak transcript tokens. Missing or short: transcribe answers 503 before any quota or AI spend, and `/complete` grades every speak answer wrong |
| `ZABOON_TRUST_PROXY` | runtime | no | apps/web/lib/server/env.ts | Self-hosting only: `1` behind a proxy that overwrites `X-Forwarded-For`. Vercel is detected, so leave it unset there |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | – | not yet | no code reads them | Turnstile isn't wired (§3.1) |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_AMPLITUDE_API_KEY` | – | not yet | no code reads them | No Sentry or Amplitude code yet |
| `EMAIL_API_KEY` | – | not yet | no code reads it | Auth email goes through Supabase's SMTP settings (§3.1) |
| `STRIPE_*`, `VAPID_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | – | P2 | commented out in .env.example | |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` | set by Vercel | – | env.ts, apps/web/app/serwist/[path]/route.ts | `VERCEL_ENV` makes local auth mode refuse to start; the SHA versions the precached offline page |

Never put `OPENROUTER_API_KEY_BUILD`, `CONTENT_STORAGE_UPLOAD_KEY` or `SUPABASE_URL` (content CLI
only) on Vercel (.env.example; docs/adr/0008), and never give a secret the `NEXT_PUBLIC_` prefix
(docs/ARCHITECTURE.md §13). `NEXT_PUBLIC_*` and `CONTENT_BASE_URL` are compiled into the build:
changing them needs a new deployment.

### 5.3 Must stay unset, in Production and in Preview

- **`AUTH_MODE`** (unset means `supabase`). `local` accepts HS256 tokens signed with a per-machine
  secret, honors the `x-test-now` and `x-test-flags` headers (apps/web/lib/server/clock.ts,
  flags.ts) and returns contract-violation details (with-route.ts). It refuses to start when
  `VERCEL_ENV` is set or the database isn't on loopback (env.ts), so every API call would answer 500.
- **`ZABOON_DEV_AUTH`**: `1` at build time adds `*.dev.ts` to `pageExtensions`, compiling
  `/api/dev/auth/*` into the build (apps/web/next.config.ts). Those routes mint tokens and write
  `auth.users` over a superuser connection (auth/dev-users.ts), and the flag also unhides the
  `/gallery` and `/challenges` dev pages (apps/web/app/(dev)/*/page.tsx). The dev routes still refuse
  outside local mode (with-route.ts), but the release rule is "no dev routes in the output"
  (scripts/verify-build.sh; docs/ARCHITECTURE.md §15).
- **`NEXT_PUBLIC_AUTH_MODE`** (not in .env.example): `local` at build time makes the browser sign in
  through `/api/dev/auth/*`, a 404 in production, and turns on test hooks (`x-test-now`/
  `x-test-flags` from localStorage, test renderers) (apps/web/lib/auth-client.ts, api-client.ts,
  components/lesson/test-renderers.tsx).
- `ZABOON_DEV_AUTH_SECRET` and `ZABOON_CONTENT_DIR`: local and test only (auth/local.ts, content.ts).

### 5.4 Cron jobs and plan limits

- apps/web/vercel.json schedules `GET /api/cron/league-rollover` at `0 0 * * 1` (Mondays 00:00 UTC).
  Vercel sends `Authorization: Bearer $CRON_SECRET`; the route compares it in constant time and
  fails closed (apps/web/lib/server/auth/cron.ts).
- The rollover is idempotent, closes missed weeks oldest first and runs whatever the `leagues` flag
  says (apps/web/lib/server/engagement/rollover.ts), so a late or repeated run is safe.
- Plan limits: schedules more often than daily need Vercel Pro (docs/ARCHITECTURE.md §8), so the
  weekly rollover fits Hobby. The other Vercel jobs in §8 (guest cleanup, 15-minute reminders,
  entitlement sweep) aren't implemented; the reminders would need Pro. pg_cron jobs (§3.2) run in
  Supabase and don't count.
- A new cron must be a GET route with `auth: 'cron'` in the contract (apps/web/vercel.test.ts).

## 6. Feature flags and app config

- **Defaults:** every flag in `FLAG_DEFAULTS` is `false` (packages/contracts/src/schemas.ts). Wave 3:
  `leagues`, `quests`, `shop`, `practiceHub`, `persianKeyboard`, `letterTrace`. Wave 4 is still
  being built; keep `speak`, `stories`, `placement`, `offline`, `energy`, `plus`, `email` and `push`
  off (docs/PROGRESS.md).
- **Storage:** the `app_config` row `flags` holds `{flagName: boolean}`, merged over the defaults.
  Every other row is a top-level `AppConfig` key (`hearts`, `xp`, `rateLimits`, …) deep-merged over
  `DEFAULT_APP_CONFIG` (packages/db/src/repos/content.ts). An invalid row is silently ignored; a
  misspelt flag name is accepted and does nothing. Servers cache it for 30 s
  (apps/web/lib/server/config.ts). The `x-test-flags` header works in local mode only (flags.ts).

| Flag | When on (its routes answer 404 while it is off) |
|---|---|
| `leagues` | `GET /api/leaderboard` (linked accounts only) and league XP at lesson commit |
| `quests` | `GET /api/quests`; completed quests grant coins |
| `shop` | `GET /api/shop`, `POST /api/shop/purchase`, `POST /api/lives/refill` |
| `practiceHub` | `GET /api/practice` and practice modes in `POST /api/sessions` |
| `persianKeyboard` | Typed-Persian challenges in sessions |
| `letterTrace` | Letter-tracing challenges in letters sessions |

(packages/contracts/src/routes.ts; apps/web/lib/server/engagement/flags.ts, commit.ts;
apps/web/lib/server/sessions.ts.) Turn them on in the SQL editor, and send the same statement with
`false` to turn one off; `GET /api/meta` shows the result in `flags`:

```sql
INSERT INTO public.app_config (key, value)
VALUES ('flags', '{"leagues": true, "quests": true, "shop": true, "practiceHub": true,
                   "persianKeyboard": true, "letterTrace": true}')
ON CONFLICT (key) DO UPDATE SET value = public.app_config.value || EXCLUDED.value, updated_at = now();
```

- **Owner:** turn Wave 3 on only after its QA with the flags on (ws-qa-2) has finished; it hasn't
  started yet (docs/PROGRESS.md).
- **Turning on `speak`** (`{"speak": true}` in the same row):
  - First set `APP_SIGNING_SECRET` and `OPENROUTER_API_KEY_APP` (§5.2), and give the key a credit
    limit in OpenRouter: it is the only thing bounding total spend.
  - The model (`openai/gpt-audio-mini`) takes `wav` or `mp3` input only; a live probe on 2026-09-26
    refused `webm` and `m4a` with a 400. The browser therefore converts every recording to a 16 kHz
    mono 16-bit WAV (apps/web/lib/speech/convert.ts). The server refuses anything else and measures
    the duration itself (apps/web/lib/speech/wav.ts). In the probe a 2 s clip cost about $0.00004,
    and it transcribed "سلام، خوبی؟" exactly.
  - Each learner gets `speech.dailyQuota` (60) transcriptions per UTC day of at most
    `speech.maxDurationMs` (15 s). A transcription counts before the call and is given back only
    when the provider refuses the request. Guests are learners too, so there is no global daily cap
    yet (backlog).
- Clients send `x-zaboon-app-version: 0.1.0` (apps/web/lib/api-client.ts). Raising `minAppVersion`
  above that answers 426 to every current client (with-route.ts).

## 7. Post-deploy smoke test

```bash
BASE=https://<domain>
curl -s "$BASE/api/meta"
#  200 {"contentVersion":<N>,"minAppVersion":"0.1.0","graderVersions":[…],"flags":{…},"authMode":"supabase"}
#  404 "no published content for course fa-en" → §4 isn't done; 500 → env or database (logs)
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/home"                        # 401 (sign-in required)
curl -s -H 'x-zaboon-app-version: 0.0.1' "$BASE/api/meta"                        # 426 upgrade_required
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/dev/auth/anonymous"  # 404
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/gallery"                         # 404
curl -s "$BASE/api/cron/league-rollover"                                          # 401 cron secret required
curl -s -H "authorization: Bearer $CRON_SECRET" "$BASE/api/cron/league-rollover" # 200 {"closed":[…],"current":{…}}
curl -s "$BASE/robots.txt" | grep -i sitemap                    # the production origin, not localhost
curl -s "$BASE/serwist/sw.js" | grep -c '<content-host>'        # ≥ 1: the build saw CONTENT_BASE_URL
curl -sI "$CONTENT_BASE_URL/fa-en/v<N>/manifest.json"           # 200 and the long-lived cache-control
```

(apps/web/app/api/meta/route.ts; with-route.ts; `ERROR_STATUS` in packages/contracts/src/schemas.ts;
docs/ARCHITECTURE.md §15; apps/web/app/robots.ts; apps/web/app/serwist/[path]/route.ts.)

In a private browser window:

1. Open `$BASE/` → **Get started** → onboarding (any reason, "I'm new to Persian", a goal, age ≥ 13).
   A guest is created and the first lesson opens at `/lesson?course=fa-en&kind=lesson&level=u01-l1`
   (`firstStop`, apps/web/components/pages/Onboarding.tsx; apps/web/lib/lesson/request.ts). In
   DevTools, `POST /api/onboarding` and `POST /api/sessions` answer 200, and images and audio load
   from `CONTENT_BASE_URL` without CORS errors in the console.
   - Guest sign-in fails: anonymous sign-ins off, CAPTCHA on, or the `auth.users` trigger missing
     (§3.2). Every call 401: signing keys or issuer (§3.1). A 500 `auth keys are unavailable` (log
     line `[auth] the Supabase key set is unavailable`): the JWKS is unreachable.
2. Finish the lesson: `POST /api/sessions/<id>/complete` answers 200 and shows 10 XP (15 when
   perfect) and a 1-day streak (`DEFAULT_APP_CONFIG`, packages/contracts/src/schemas.ts). Reload
   `/learn`: XP and streak persist.
3. Put the `authorization` header value (`Bearer …`) of any `/api/*` request into `AUTH`, then:
   - `curl -s -H "authorization: $AUTH" "$BASE/api/home"` → 200 with `xpTotal` and `streak.current: 1`.
   - `curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: $AUTH" -H 'x-test-flags: {"shop":true}' "$BASE/api/shop"`
     → 404 while `shop` is off: production ignores the header (apps/web/lib/server/flags.ts).
4. SQL: `SELECT user_id, amount, reason, local_date FROM public.xp_ledger ORDER BY id DESC LIMIT 3;`
   shows the lesson.
5. Settings → Account: add an email. The link arrives (SMTP works), and afterwards `/api/home` shows
   `isAnonymous: false`. Delete this test account: `DELETE /api/account` answers 200
   `{"deleted":true}`. A 500 saying `SUPABASE_SECRET_KEY is not set` or
   `auth admin delete failed (<status>)` points at the secret key (apps/web/lib/server/auth/admin.ts).
6. After 15 minutes, `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;` shows
   successful runs. After the next Monday 00:00 UTC, Vercel's cron log shows a 200 for the rollover.

## 8. Operations

**Routine release:** `pnpm verify` green → apply new migrations with `supabase db push` before the
app that needs them goes out (the docs' order, docs/ARCHITECTURE.md §13; migrations are expand-only,
§12). The documented automatic CD doesn't exist and Vercel builds `main` by itself, so push before
merging → merge → the §7 `curl` checks → publish content if it changed (§4).

| Secret | Lives in | Rotation |
|---|---|---|
| `app_server` password | Postgres; `DATABASE_URL_APP_SERVER` on Vercel | `\password app_server` as `postgres` → update the variable → redeploy. Requests fail in between. **Owner:** pick a quiet window |
| `CRON_SECRET` | Vercel | Update and redeploy; nothing else stores it (auth/cron.ts) |
| `SUPABASE_SECRET_KEY` | Vercel | New key in Supabase → update → redeploy → revoke the old one → re-run §7 step 5 |
| JWT signing key | Supabase | Rotate in Supabase. The server reads the JWKS at runtime (auth/supabase.ts), so no redeploy; keep the old key published until tokens signed with it expire |
| Publishable key | Vercel (compiled into the build) | Update and redeploy |
| `CONTENT_STORAGE_UPLOAD_KEY`, `OPENROUTER_API_KEY_BUILD` | Content CI or the content machine | Rotate independently; the two OpenRouter keys have separate credit limits (docs/adr/0008) |
| SMTP credentials | Supabase Auth settings | Rotate at the provider, then update Supabase |

**Rolling back a deploy:** promote the previous production deployment in Vercel. Never roll a
migration back; fix forward. An older build keeps working on the newer schema because migrations
are expand/contract (docs/ARCHITECTURE.md §12). The service worker takes over on the next load
(`skipWaiting`, `clientsClaim`, apps/web/app/sw.ts). To force old clients to update, raise
`minAppVersion` only after shipping a higher `APP_VERSION` (§6). Content rolls back forward only,
as v\<N+1\> (§4).

**Logs:**

- Vercel runtime logs: `[api] unhandled error`, `[api] <METHOD> <path> response violates its
  contract` (with-route.ts), `[auth] the Supabase key set is unavailable` (auth/supabase.ts) and
  `[account] merged guest into member` (account.ts). Clients get `{"error":{"code","message"}}`
  with `cache-control: no-store` (apps/web/lib/server/errors.ts). Vercel also lists the cron runs.
- Supabase logs: Postgres (for example `app_server` hitting its 10 s lock or 15 s statement
  timeout), Auth and Storage; migration warnings start with `zaboon:`. pg_cron's run history is
  `cron.job_run_details`.
- In the app: content reports at `/admin` and nightly per-item error rates in `public.item_stats`
  (docs/ARCHITECTURE.md §8). There is no Sentry or Amplitude yet (§5.2).

## 9. Known gaps and owner actions

1. **`mvp` tag.** The MVP gate passed on `963915d` (#38). The session git proxy refuses tag pushes,
   so the owner runs `git tag -a mvp 963915d && git push origin mvp` (docs/PROGRESS.md).
2. **AI budget.** $7.57 of the internal $9.50 cap is spent (the key's hard limit is $10); the
   remaining ~$1.93 isn't enough for Units 2–5 media, which need a larger budget. Add
   `OPENROUTER_API_KEY_BUILD`/`_APP` to the environment settings so the keys survive the container
   (docs/PROGRESS.md; ops/state.json).
3. **Human-review backlog** (docs/PROGRESS.md): native-speaker review of all content and audio
   (everything is `status: draft`); art-director approval of the style bible and art; a Rive
   animator (the characters are SVG placeholders); legal review (trade dress; sanctions before
   contracting anyone in Iran); deployment accounts (Supabase, Vercel, Stripe, email, Turnstile,
   domain).
4. **Publishing drafts** is an owner decision (§4). Only Unit 1 has full content; units 2–5 are
   stubs so the path renders (content/fa-en/course.yaml).
5. **Abuse and guest cleanup.** Turnstile isn't wired (§3.1), and `/api/cron/guest-cleanup`
   (docs/ARCHITECTURE.md §8) doesn't exist, so anonymous users are never deleted. Only the Auth
   rate limit throttles guest creation.
6. **No CD pipeline.** The docs describe `supabase db push`, then promote on merge
   (docs/ARCHITECTURE.md §13), but CI is manual-only (.github/workflows/ci.yml). Use §8's order.
7. **Flags.** Wave 3 QA with the flags on is still pending; Wave 4 is in development (§6).
8. **Documented but not implemented:** `preferredRegion` (§2), Sentry and Amplitude, the CSP
   (docs/ARCHITECTURE.md §9; no headers in apps/web/next.config.ts), OAuth/PKCE (§3.1) and
   runtime AI.
9. **Config drift.** `.env.example` lacks `SUPABASE_URL` (content CLI) and `NEXT_PUBLIC_AUTH_MODE`,
   and lists several names no code reads (§5.2). The repo has no `supabase/config.toml` (§3.2), no
   `supabase/seed.sql` (listed in docs/ARCHITECTURE.md §4) and no `apps/web/proxy.ts` (§1).
