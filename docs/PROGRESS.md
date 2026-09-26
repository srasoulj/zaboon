# Zaboon implementation progress

> Maintained by the orchestrator session. The live checklist is the GitHub tracking issue; durable
> machine-readable state is in [`ops/state.json`](../ops/state.json). Plan and rules: [CLAUDE.md](../CLAUDE.md).

## Waves

| Wave | Scope | Status |
|---|---|---|
| 0a | Tooling, local Postgres (no Docker), SessionStart hook, CI, secret scan | ✅ done (#2) |
| 0b/0c | Contracts, stubs, test oracles (641 cases) + runners, fixture course, Unit 1 seed, content build/publish, ADR 0009, CLAUDE.md, ownership gate | ✅ done (#3, #5, #8) |
| skeleton | Server framework (`withRoute`, auth, clock, content loader), dev auth, lesson API, e2e; app shell (auth + API clients, chrome, renderer registry, fixtures) | ✅ done (#9, #12, #18) |
| 1 | farsi+grader, session engine+srs+game rules, database, UI kit, content CLI + AI client | ✅ done (#6, #7, #10, #11, #14; review fixes #15, #16) |
| 2 | API, pages, lesson player, 13 challenge renderers, path + letters; AI content; QA → tag `mvp` | ✅ done: the MVP gate passed on `963915d` (#38); fix rounds #37, #39–#45 |
| 3 | Leagues, quests, coins/shop, practice hub, Persian keyboard + typing, letter tracing | ✅ merged: prep #46, ws-engagement #48, ws-typing #49, registry test #50; review fix rounds #52 and #53, and the ownership handover #51; QA with the flags on (ws-qa-2, #57), its bugs fixed in #59 |
| 4 | Stretch: **speak** and **Stories** behind flags. Plus/Stripe, reminders and push, energy, placement and offline are deferred (the weekly usage limit) | ✅ prep #56 and #58; **speak** #60 with review fixes #61 and #65; **Stories** #64 with its path contract fix (#66). fa-en has three AI-composed draft stories (units 1, 2 and 4) |
| 5 | Hardening: security + code review, audits, docs sync, deploy runbook | ✅ runbook ([DEPLOY.md](DEPLOY.md), #58); security review fixes #61; client-IP trust #62 and release on deploy #67 (owner's session); flaky QA tests #63, #66; Lighthouse audit, formatter pass with a format gate in verify, `.env.example` sync (#68) |

## Final report (2026-09-26, orchestrator)

Every wave in the plan is done: the MVP, Wave 3 (engagement, typing, tracing) and the scoped-down Wave 4 (speak, Stories). Every feature is behind a flag (off by default), and `main` passes the full `pnpm verify`:

- typecheck and lint;
- the format check;
- 2,213 unit and DOM tests and 332 DB tests (with pgTAP);
- content validation;
- 300 Playwright e2e tests on desktop and mobile Chromium, including the golden path through all 13 MVP challenge types;
- the production build (no dev routes) and the secret scan.

**What exists**

- **Learner app** (Next.js 16, Supabase Auth only, every read and write through typed route handlers):
  - guest start, onboarding with the 13+ gate, and the heritage track;
  - the Duolingo-style path with units, chests, practice and reviews;
  - the lesson player: 13 challenge types, hearts, streaks with freezes, XP and daily goals, an offline outbox, and resume;
  - the letters track with tracing, and the Persian keyboard with typed answers;
  - leagues, quests, coins and shop, and the practice hub;
  - speak (microphone to a signed transcript), and Stories;
  - profile, settings, account merge, export and deletion, admin report triage, SEO alphabet pages, and a PWA.
- **Learning engine:**
  - the Persian normalizer and grader (a pattern DAG with typo, variant and register handling);
  - a deterministic session generator;
  - FSRS spaced repetition;
  - game rules in TypeScript, checked by 641 oracle cases.
- **Content:**
  - the frozen fixture course, which the e2e tests use;
  - fa-en: text drafts for units 1–5 (Astra) and Unit 1 media (79 clips, 8 illustrations, 5 portraits);
  - three draft stories;
  - everything is `status: draft` until a native speaker reviews it.
- **Operations:** the deploy runbook ([DEPLOY.md](DEPLOY.md)), and release on deploy (#67): each production build applies pending migrations and publishes changed content. Also the RLS and grants model with pgTAP isolation tests, rate limits, body caps, the anti-cheat rules, and a cron rollover.

**Lighthouse** (13.5, mobile preset with simulated throttling; production build served locally; flags at their defaults):

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` (landing) | 87 | 100 | 100 | 100 |
| `/learn-persian` | 87 | 100 | 100 | 100 |
| `/learn` (path) | 87 | 100 | 100 | 63 |
| `/letters` | 85 | 100 | 100 | 54 |
| `/profile` | 87 | 100 | 100 | 63 |

- The signed-in pages are `noindex` on purpose, which is the SEO "is-crawlable" failure. `/letters` also has one link without descriptive text.
- Performance is held back by about 500 ms of total blocking time (JavaScript on the main thread). First and largest contentful paint are 0.6–1.7 s.
- Both are on the hardening backlog below. The plan's "PWA ≥ 90" check no longer exists: Lighthouse 12 removed the PWA category. The service worker and manifest are covered by e2e instead.

**Budget:** AI spend is $7.72 of the $9.50 internal cap. 15 of 20 sessions were used, and the wall clock was about 25 h of 48.

**The owner still needs to** (details in [DEPLOY.md](DEPLOY.md), "First deploy, in order", and tracker #4):

- turn on anonymous sign-ins in Supabase;
- enable pg_cron;
- set the Vercel Root Directory and environment variables, including `DATABASE_URL_MIGRATE` (Production only). The production build then applies the migrations and publishes the content (#67);
- push the `mvp` tag;
- before turning `speak` on, set `APP_SIGNING_SECRET` and a credit-limited `OPENROUTER_API_KEY_APP`.

## Workstreams

| ID | Wave | Owns | Status | PR |
|---|---|---|---|---|
| ws-farsi-grader | 1 | `packages/farsi`, `packages/grader` | ✅ merged | #11 |
| ws-engine | 1 | `packages/session-engine`, `srs`, `game-rules` | ✅ merged | #10 |
| ws-db | 1 | `supabase/migrations`, `packages/db` | ✅ merged | #6, #15 |
| ws-ui | 1 | `packages/ui` | ✅ merged | #7, #16 |
| ws-content-cli | 1 | `packages/ai`, `tools/content-cli` | ✅ merged | #14 |
| ws-api | 2 | `apps/web/app/api`, `apps/web/lib/server` | ✅ merged | #17, #23, #26 |
| ws-renderers | 2 | 13 challenge renderers + dev gallery | ✅ done; its paths go to ws-typing | #21, #31, #37 |
| ws-player | 2 | lesson player, offline outbox, resume | ✅ done; its player paths go to ws-engagement | #22, #30, #39 |
| ws-path-letters | 2 | path, guidebook, letters (practice goes to ws-engagement) | ✅ merged, incl. round 2 ([spec](../ops/prompts/ws-path-letters.md)) | #32, #40, #43 |
| ws-pages | 2 | onboarding, profile, settings, admin, marketing, PWA | ✅ merged, incl. round 2; the dropped-merge notice is mounted in the shell ([spec](../ops/prompts/ws-pages.md)) | #35, #41, #44 |
| ws-content-gen | 2 | `content/fa-en` (orchestrator, uses the AI key) | ✅ text drafts for units 1–5; ✅ Unit 1 media: 79 audio clips (+30 slow, 30 envelopes), 8 illustrations, 5 portraits | #20, #24, #38 |
| ws-qa-1 | 2 | `e2e/qa`, `apps/web/tests/qa` | ✅ merged; found #27–#29 (fixed) ([spec](../ops/prompts/ws-qa.md)) | #33 |
| ws-engagement | 3 | leagues, quests, coins/shop, practice hub, lesson player, sessions/home on the server | ✅ done, including the review fixes; its paths went to ws-typing for Wave 4 ([spec](../ops/prompts/ws-engagement.md)) | #48, #53 |
| ws-typing | 3, 4 | Wave 3: Persian keyboard, typed Persian, letter tracing (✅ incl. review fixes). Wave 4: speak (✅ #60) and Stories (✅ #64), owning the engine, player, sessions and content CLI ([Wave 3 spec](../ops/prompts/ws-typing.md), [Wave 4 spec](../ops/prompts/ws-wave4.md)) | #49, #52, #60, #64 |
| ws-qa-2 | 3 | `e2e/qa`, `apps/web/tests/qa`: the Wave 3 flows with the flags on | ✅ merged: 39 DB and 6 e2e tests; its bugs #54 and #55 are fixed by the orchestrator ([spec](../ops/prompts/ws-qa-2.md)) | #57 |

**MVP gate, passed on `963915d` (#38, 20:03 UTC).**

- The full `pnpm verify` ran on that exact tree:
  - typecheck, lint, 1,605 unit and DOM tests, 165 DB tests, content validate;
  - 230 e2e tests, including the committed golden path (all 13 MVP challenge types through the real renderers and player, desktop and mobile);
  - the production build, with no dev-auth routes;
  - the secret scan.
- No blocker issues were open.
- **The `mvp` tag is waiting on the owner.** This session's git proxy refuses tag pushes (HTTP 403), so the owner runs `git tag -a mvp 963915d && git push origin mvp`.

**Fix rounds after the MVP.** They were merged one at a time, each after an independent review and a full verify on the exact merge result:

- #37: renderers.
- #39: player. The outbox sender is identity-safe, and Enter means CHECK only on a selected choice card.
- #40: path and letters. Focus ring, popover focus, contrast, guidebook audio rewritten on a parsed tree, bare Persian wrapped.
- #41: pages. robots.txt, pending merges, service-worker media caching.
- Two orchestrator fixes:
  - #42 exposes the content base to the browser. Without it, production audio would have been refused without any error.
  - #45 makes `looseKey` idempotent. fast-check found a counterexample during a merge gate.

**Deployment:** the user is deploying `main` to Vercel. Hotfix #34 (from the user's own session)
made `next build` independent of runtime auth configuration; `pnpm verify` now runs a production
build too, so a build break is caught before merge. The Vercel project still needs its environment
variables (names in `.env.example`; list in #34). Deploy runbook notes:

- The Vercel project's Root Directory must be `apps/web`. `apps/web/vercel.json` holds the Monday 00:00 UTC league-rollover cron.
- Set `CRON_SECRET`, or the cron route refuses every call.
- The rollover route exists since #48. It is idempotent and closes missed weeks oldest first.
- `CONTENT_BASE_URL` is optional since the release on deploy: unset, the app uses the Supabase project's public `content` bucket (apps/web/lib/content-base-url.ts). The browser's media allowlist and the service worker's cache rules are inlined when the app is built.
- Every production build applies pending migrations and publishes changed content before `next build` (scripts/release.ts, `DATABASE_URL_MIGRATE`; [DEPLOY.md](DEPLOY.md) §3.2, §4, §8), so merging to `main` is the whole release.

**Golden path (15:55 UTC):** the fixture lessons u01-s0, u01-l1 and u01-l2 play end to end through
the real renderers, the lesson player, the API and Postgres on desktop and mobile Chromium: all 13 MVP
challenge types graded correct, XP awarded, no console or network errors. The post-merge reviews of
#21–#23 found one blocker (letter_sound played the answer before CHECK) and several majors (outbox
identity and head-of-line blocking, skip semantics, Enter on focused buttons, per-item mistakes,
matching focus); they went back to their owners as fix rounds.

Post-merge follow-ups applied by the orchestrator: the lesson outbox now replays app-wide
(`providers.tsx`), cached queries reset when the signed-in identity changes, `app_server` has lock,
idle-in-transaction and statement timeouts (a backstop for the #23 pool deadlock), the API client
takes query strings, and the contracts gained the `guidebook` route plus letter/word audio URLs.

**Speak (#60) post-merge review** (no blockers; three majors about spend on the paid key, fixed by
the orchestrator in the Speak hardening PR):

- **The format.** A live probe of `openai/gpt-audio-mini` showed it takes only `wav` and `mp3`
  (`webm` and `m4a` get a 400), so no real recording could have been transcribed. The browser now
  converts every recording to a 16 kHz mono 16-bit WAV (`lib/speech/convert.ts`).
- **The duration** was only what the client declared. The server now measures the WAV itself,
  and sends the provider a canonical copy of exactly the measured samples.
- **The quota** was given back after answers the provider had billed, including empty
  transcripts, so a caller sending silence could transcribe for free. Now only a provider refusal
  (an HTTP error status) gives it back, and an empty transcript is a 200 with `""`.
- **Signing** is checked before any quota or provider spend.
- Smaller fixes:
  - the transcription call gets 20 s and one retry;
  - SKIP during a transcription no longer leaves "Checking…" on screen;
  - the local DB-test template is rebuilt when any migration changes, not only the last one;
  - the comments and test titles on transcripts and the trust window now say what is true.

**Stories (#64) post-merge review** (orchestrator; no blockers):

- Stories are gated by `flags.stories`. A story session needs no hearts and never spends any (`/events` included), it isn't rated (no SRS, no mistakes), and it completes its level.
- The migration replaces the `sessions.kind` CHECK safely (NOT VALID, then validated).
- Two notes:
  - the no-hearts rule lives in `sessions.ts`, not in `@zaboon/game-rules` (backlog);
  - the PR reformatted the content CLI's seed fixtures (quote style only; every file parses to the same data).

**fa-en stories** (orchestrator, $0.157 of Astra):

- The composer picks, orders and assigns the unit's own validated sentences (and earlier units'), and writes the English comprehension questions. The lines' tokens, lexemes and audio come from those sentences, so they pass the validator by construction.
- The stories:
  - `st_u01_visit`, "Tea with Grandma": 8 lines, all voiced by the recorded speakers;
  - `st_u02_new_friend`, "A New Friend": 9 lines;
  - `st_u04_lunch`, "Dinner with Grandma": 8 lines.
- The stories in units 2 and 4 have no audio yet, like the rest of those units. All three are `status: draft`, pending native review.

## AI spend

This project's key has used **$7.72** of the internal **$9.50** cap (checked 09:50 UTC on Sep 26;
the key's own hard limit is $10). Paid calls since then: a speak format probe (under $0.0001) and
the three fa-en stories ($0.157 of Astra):

- text pilot: $0.002;
- text drafts, units 1–5 (Astra): $2.76;
- art: $1.02 (style bible, Hodhod turnaround and expressions, Maman Bozorg);
- Unit 1 media: $3.79. That covers 79 TTS clips (gpt-audio), 8 `select_image` illustrations and
  5 cast portraits (GPT Image), plus the pilots.

About **$1.78** of the cap is left. That isn't enough for Units 2–5 media, so this is on the
human backlog. The account balance is about $0.99; other usage on the account isn't this
project's.

**Unit 1 media** (all `status: draft`):

- 79 word and phrase clips, loudness-normalized to about −16 LUFS, plus 30 slow clips and
  30 mouth envelopes for the sentences.
- Illustrations: tea, water, bread, apple, ice cream, door, river and mulberry.
- Portraits: Shirin, Dariush, Kian, Leila and Babak.
- The images ship as transparent WebP (9–43 KB). The PNG originals are kept next to them as
  masters, with provenance sidecars.

The TTS pipeline fixes behind the media are in `packages/ai` and `tools/content-cli`:

- OpenRouter audio output needs `stream: true`, so audio is streamed as pcm16.
- Silent takes are rejected.
- Leading padding and edge artifacts are trimmed.

Known gap (hardening backlog): `content audio` uses a single-pass `loudnorm`, which undershoots
on very short clips. The committed clips were normalized separately, so re-running
`content audio --force` would undo that fix until `audio.ts` does a two-pass loudnorm.

## Hardening backlog (Wave 5)

- **Content CLI:** `audio.ts` uses a single-pass loudnorm (see above).
- **Pending merges:** replace the stored guest token with a server-minted merge ticket (a contract change).
- **Auth:** PKCE `flowType` in `auth-client.ts`.
- **Grader and renderer:** agree on how punctuation is handled in cloze answers.
- **Traces:** the server checks the thresholds on client-reported coverage and precision. Re-scoring the strokes would need a server-side glyph rasterizer. Declined traces are non-rated since #53.
- **ws-api:** add `repos.learning.deleteLevelProgress`.
- **Performance:** cut about 500 ms of main-thread JavaScript on first load (Lighthouse total blocking time). Split the lesson player and animation code out of the shell, check whether supabase-js can load later, and target modern browsers to drop the 14 KiB of legacy polyfills. Also fix the one non-descriptive link on `/letters`.
- **WebKit e2e:** needs CI runners; locally only Chromium runs.
- **Unused Unit 1 illustrations:** only 4 of the 8 appear in Unit 1 (the `select_image` options are fixed per challenge). Water, river, mulberry and ice cream wait for later units.
- **Path banners:** show the character portraits (the chat screen gets them in Wave 3, ws-typing).
- **From the deploy runbook ([docs/DEPLOY.md](DEPLOY.md), §9):**
  - wire Turnstile into guest sign-in, and add the guest-cleanup cron (ARCHITECTURE §8);
  - CSP and security headers;
  - `turbo.json` env passthrough, so `CONTENT_BASE_URL` reaches `next build` under Turborepo;
  - a CD step for `supabase db push`;
  - `content_versions.min_app_version` is never read.
- **From the Wave 5 security review (no critical or high findings). Two mediums are fixed:** bounded inputs and body caps; the course-id cache. Still open (low):
  - **Auth:** `flowType: 'pkce'` in `auth-client.ts`. The implicit flow accepts a session from the URL fragment, which enables login CSRF into a pending merge. Also complete a pending merge only when the signed-in email matches the one typed.
  - **Merge:** re-check the guest with the Auth Admin API (`is_anonymous`, no identities) before merging and before deleting it, because a stale guest token can still say `is_anonymous: true`.
  - **Anti-cheat:** flag a session committed sooner than `challenges × minMsPerChallenge` after it started, by the server clock. Cap league XP per week, and quest coins for guests or across merges.
  - **CI and hooks:** pin actions to commit SHAs; pin `detect-secrets` in the SessionStart hook.
  - **Headers:** when CSP lands, include `frame-ancestors 'none'`, `nosniff`, HSTS and `Referrer-Policy`. Keep Supabase "Confirm email" on.
- **Speak:**
  - add a global daily transcription cap in `app_config`. The quota is per learner, and guests cost nothing but Turnstile, which isn't wired yet;
  - check the WAV conversion on real Safari (iOS and macOS), where MediaRecorder records mp4/AAC. Local e2e runs Chromium only; a browser that can't decode shows "That recording didn't work", and "Can't speak now" still goes on;
  - benchmark `gpt-audio-mini` against a Gemini Flash audio model on real learner recordings (LEARNING-ENGINE).
- **Stories:**
  - move the no-hearts rule for story sessions into `@zaboon/game-rules` (`settleCommit`, `applyMistakeEvent`) with oracle cases; today `sessions.ts` skips them for `kind: 'story'`;
  - TTS for the unit 2 and 4 story lines (with the rest of those units' media).
- **Deferred Wave 4 features:** Plus/Stripe and entitlements, reminders (email/Web Push), energy, the placement test, offline lessons. A file-level design exists: contracts, schemas, seams, ownership, specs.

## Human-review backlog (cannot be automated honestly)

- Native-speaker review of all course content and audio (every item is `status: draft`).
- Art director approval of the style bible and generated art.
- A Rive animator for the character rigs (placeholders are SVG).
- Legal review: trade dress; sanctions before contracting anyone in Iran.
- Accounts for deployment: Supabase, Vercel, Stripe, email provider, Turnstile, domain.
- **A larger AI budget** for Units 2–5 media (the $9.50 internal cap covers Unit 1 only).
- Add `OPENROUTER_API_KEY_BUILD` / `OPENROUTER_API_KEY_APP` to the environment settings so the key survives this container.
- GitHub Actions never assigns runners on this repository (billing or account setting), so CI is manual-only and `pnpm verify` is the gate.
- Push the `mvp` tag (`git tag -a mvp 963915d && git push origin mvp`). This session's git proxy refuses tag pushes.
