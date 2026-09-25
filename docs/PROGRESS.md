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
| ws-api | 2 | `apps/web/app/api`, `apps/web/lib/server` | 🔍 in review | #17 |
| ws-renderers | 2 | 13 challenge renderers | 🔄 working | |
| ws-player | 2 | lesson player | 🔄 working | |
| ws-path-letters | 2 | path, letters | ⏳ after ws-api | |
| ws-pages | 2 | onboarding, profile, settings, admin, marketing, PWA | ⏳ after ws-api | |
| ws-content-gen | 2 | `content/fa-en` (orchestrator, uses the AI key) | 🔄 text drafting with Astra; art partly done | |
| ws-qa-N | 2+ | `e2e/` | ⏳ | |

## AI spend

The OpenRouter **account** is the binding limit: $60 total credit, about $0.35 left when checked
at 12:40 UTC (most of it was spent before this project). This project's key has used $2.78:

- text pilot: $0.002;
- art: $1.02 (style bible, Hodhod turnaround and expressions, Maman Bozorg);
- text drafts: in progress.

The key's own limit ($10) is not reachable until the account is topped up.

## Human-review backlog (cannot be automated honestly)

- Native-speaker review of all course content and audio (every item is `status: draft`).
- Art director approval of the style bible and generated art.
- A Rive animator for the character rigs (placeholders are SVG).
- Legal review: trade dress; sanctions before contracting anyone in Iran.
- Accounts for deployment: Supabase, Vercel, Stripe, email provider, Turnstile, domain.
- **Top up the OpenRouter account.** About $5 finishes the 5 remaining cast portraits, Unit 1 illustrations and audio; Units 2–5 media need more.
- Add `OPENROUTER_API_KEY_BUILD` / `OPENROUTER_API_KEY_APP` to the environment settings so the key survives this container.
- GitHub Actions never assigns runners on this repository (billing or account setting), so CI is manual-only and `pnpm verify` is the gate.
