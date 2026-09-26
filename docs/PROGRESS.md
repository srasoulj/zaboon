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
| 3 | Leagues, quests, coins/shop, practice hub, Persian keyboard + typing, letter tracing | ✅ merged: prep #46, ws-engagement #48, ws-typing #49 (the owner merged both at 23:40 UTC). 🔄 post-merge review, QA with the flags on (ws-qa-2) |
| 4 | Stretch: speak, stories, placement, offline, energy, Plus/email/push behind flags | 🔄 prep being designed; four workers: ws-speak, ws-stories, ws-placement-offline, ws-plus |
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
| ws-renderers | 2 | 13 challenge renderers + dev gallery | ✅ done; its paths go to ws-typing | #21, #31, #37 |
| ws-player | 2 | lesson player, offline outbox, resume | ✅ done; its player paths go to ws-engagement | #22, #30, #39 |
| ws-path-letters | 2 | path, guidebook, letters (practice goes to ws-engagement) | ✅ merged, incl. round 2 ([spec](../ops/prompts/ws-path-letters.md)) | #32, #40, #43 |
| ws-pages | 2 | onboarding, profile, settings, admin, marketing, PWA | ✅ merged, incl. round 2; the dropped-merge notice is mounted in the shell ([spec](../ops/prompts/ws-pages.md)) | #35, #41, #44 |
| ws-content-gen | 2 | `content/fa-en` (orchestrator, uses the AI key) | ✅ text drafts for units 1–5; ✅ Unit 1 media: 79 audio clips (+30 slow, 30 envelopes), 8 illustrations, 5 portraits | #20, #24, #38 |
| ws-qa-1 | 2 | `e2e/qa`, `apps/web/tests/qa` | ✅ merged; found #27–#29 (fixed) ([spec](../ops/prompts/ws-qa.md)) | #33 |
| ws-engagement | 3 | leagues, quests, coins/shop, practice hub, lesson player, sessions/home on the server | ✅ merged; 🔧 review fix round (tier after a late rollover, zero-coin quest grants, rollover robustness, freeze purchases, merge ledger, practice modes, declined attempts) ([spec](../ops/prompts/ws-engagement.md)) | #48 |
| ws-typing | 3 | Persian keyboard, typed Persian, letter tracing, renderers, UI kit, session engine | ✅ merged; 🔧 review fix round (mistakes-drill length, caret insertion, keyboard focus, dots in tracing, dictation leniency) ([spec](../ops/prompts/ws-typing.md)) | #49 |
| ws-qa-2 | 3 | `e2e/qa`, `apps/web/tests/qa`: the Wave 3 flows with the flags on | ⏳ starts after the post-merge review ([spec](../ops/prompts/ws-qa-2.md)) | |

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
- `CONTENT_BASE_URL` must be set at build time and at runtime. The browser's media allowlist and the service worker's cache rules are inlined when the app is built.

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

## Hardening backlog (Wave 5)

- **Content CLI:** `audio.ts` uses a single-pass loudnorm (see above).
- **Pending merges:** replace the stored guest token with a server-minted merge ticket (a contract change).
- **Auth:** PKCE `flowType` in `auth-client.ts`.
- **Grader and renderer:** agree on how punctuation is handled in cloze answers.
- **SRS:** ignore declined letter traces. For now a declined trace grades as correct, a documented simplification.
- **ws-api:** add `repos.learning.deleteLevelProgress`.
- **Formatting:** run a repo-wide formatter pass once no workers are active. The formatter isn't part of verify.
- **WebKit e2e:** needs CI runners; locally only Chromium runs.
- **Unused Unit 1 illustrations:** only 4 of the 8 appear in Unit 1 (the `select_image` options are fixed per challenge). Water, river, mulberry and ice cream wait for later units.
- **Path banners:** show the character portraits (the chat screen gets them in Wave 3, ws-typing).

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
