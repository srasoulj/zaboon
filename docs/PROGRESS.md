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
| ws-api | 2 | `apps/web/app/api`, `apps/web/lib/server` | ✅ merged; 🔧 review fixes in progress | #17, #23 |
| ws-renderers | 2 | 13 challenge renderers + dev gallery | ✅ merged; 🔧 review fixes in progress | #21 |
| ws-player | 2 | lesson player, offline outbox, resume | ✅ merged; 🔧 review fixes in progress | #22 |
| ws-path-letters | 2 | path, guidebook, letters, practice | 🔄 working ([spec](../ops/prompts/ws-path-letters.md)) | |
| ws-pages | 2 | onboarding, profile, settings, admin, marketing, PWA | 🔄 working ([spec](../ops/prompts/ws-pages.md)) | |
| ws-content-gen | 2 | `content/fa-en` (orchestrator, uses the AI key) | ✅ text drafts for units 1–5; 🔄 Unit 1 media | |
| ws-qa-1 | 2 | `e2e/qa`, `apps/web/tests/qa` | 🔄 working ([spec](../ops/prompts/ws-qa.md)) | |

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

This project's key has used **$3.77** of the internal **$9.50** cap (checked 15:30 UTC):

- text pilot: $0.002;
- text drafts, units 1–5 (Astra): $2.76;
- art: $1.02 (style bible, Hodhod turnaround and expressions, Maman Bozorg).

The account itself was topped up (balance about $6.50; other usage on the account isn't this
project's). The remaining ≈ $5.70 goes to Unit 1 media, in this order: audio, `select_image`
illustrations, then the five remaining cast portraits.

## Human-review backlog (cannot be automated honestly)

- Native-speaker review of all course content and audio (every item is `status: draft`).
- Art director approval of the style bible and generated art.
- A Rive animator for the character rigs (placeholders are SVG).
- Legal review: trade dress; sanctions before contracting anyone in Iran.
- Accounts for deployment: Supabase, Vercel, Stripe, email provider, Turnstile, domain.
- **A larger AI budget** for Units 2–5 media (the $9.50 internal cap covers Unit 1 only).
- Add `OPENROUTER_API_KEY_BUILD` / `OPENROUTER_API_KEY_APP` to the environment settings so the key survives this container.
- GitHub Actions never assigns runners on this repository (billing or account setting), so CI is manual-only and `pnpm verify` is the gate.
