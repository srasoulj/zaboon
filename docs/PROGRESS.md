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
| 2 | API, pages, lesson player, 13 challenge renderers, path + letters; AI content; QA → tag `mvp` | 🔄 in progress |
| 3 | Leagues, quests, coins/shop, practice hub, Persian keyboard + typing, letter tracing | ⏳ |
| 4 | Stretch: speak, stories, placement, offline, energy, Plus/email/push behind flags | ⏳ |
| 5 | Hardening: security + code review, audits, docs sync, deploy runbook | ⏳ |

## Workstreams

| ID | Wave | Owns | Status | PR |
|---|---|---|---|---|
| ws-farsi-grader | 1 | `packages/farsi`, `packages/grader` | ✅ merged | #11 |
| ws-engine | 1 | `packages/session-engine`, `srs`, `game-rules` | ✅ merged | #10 |
| ws-db | 1 | `supabase/migrations`, `packages/db` | ✅ merged | #6, #15 |
| ws-ui | 1 | `packages/ui` | ✅ merged | #7, #16 |
| ws-content-cli | 1 | `packages/ai`, `tools/content-cli` | ✅ merged | #14 |
| ws-api | 2 | `apps/web/app/api`, `apps/web/lib/server` | ✅ merged | #17, #23, #26 |
| ws-renderers | 2 | 13 challenge renderers + dev gallery | ✅ merged | #21, #31 |
| ws-player | 2 | lesson player, offline outbox, resume | ✅ merged | #22, #30 |
| ws-path-letters | 2 | path, guidebook, letters, practice | ✅ merged ([spec](../ops/prompts/ws-path-letters.md)) | #32 |
| ws-pages | 2 | onboarding, profile, settings, admin, marketing, PWA | ✅ merged ([spec](../ops/prompts/ws-pages.md)) | #35 |
| ws-content-gen | 2 | `content/fa-en` (orchestrator, uses the AI key) | ✅ text drafts for units 1–5; ✅ Unit 1 media: 79 audio clips (+30 slow, 30 envelopes), 8 illustrations, 5 portraits | #20, #24, media PR |
| ws-qa-1 | 2 | `e2e/qa`, `apps/web/tests/qa` | ✅ merged; found #27–#29 (fixed) ([spec](../ops/prompts/ws-qa.md)) | #33 |

**Deployment:** the user is deploying `main` to Vercel. Hotfix #34 (from the user's own session)
made `next build` independent of runtime auth configuration; `pnpm verify` now runs a production
build too, so a build break is caught before merge. The Vercel project still needs its environment
variables (names in `.env.example`; list in #34).

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

## AI spend

This project's key has used **$7.57** of the internal **$9.50** cap (checked 19:50 UTC; the key's
own hard limit is $10):

- text pilot: $0.002;
- text drafts, units 1–5 (Astra): $2.76;
- art: $1.02 (style bible, Hodhod turnaround and expressions, Maman Bozorg);
- Unit 1 media: $3.79. That covers 79 TTS clips (gpt-audio), 8 `select_image` illustrations and
  5 cast portraits (GPT Image), plus the pilots.

About **$1.93** of the cap is left. That isn't enough for Units 2–5 media, so this is on the
human backlog. The account balance is about $1.83; other usage on the account isn't this
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

## Human-review backlog (cannot be automated honestly)

- Native-speaker review of all course content and audio (every item is `status: draft`).
- Art director approval of the style bible and generated art.
- A Rive animator for the character rigs (placeholders are SVG).
- Legal review: trade dress; sanctions before contracting anyone in Iran.
- Accounts for deployment: Supabase, Vercel, Stripe, email provider, Turnstile, domain.
- **A larger AI budget** for Units 2–5 media (the $9.50 internal cap covers Unit 1 only).
- Add `OPENROUTER_API_KEY_BUILD` / `OPENROUTER_API_KEY_APP` to the environment settings so the key survives this container.
- GitHub Actions never assigns runners on this repository (billing or account setting), so CI is manual-only and `pnpm verify` is the gate.
