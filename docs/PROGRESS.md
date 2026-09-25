# Zaboon implementation progress

> Maintained by the orchestrator session. The live checklist is the GitHub tracking issue; durable
> machine-readable state is in [`ops/state.json`](../ops/state.json). Plan and rules: [CLAUDE.md](../CLAUDE.md).

## Waves

| Wave | Scope | Status |
|---|---|---|
| 0a | Tooling, local Postgres (no Docker), SessionStart hook, CI, secret scan | ✅ done (PR #2) |
| 0b | Contracts, stubs + contract tests, test oracles, fixture course, Unit 1 seed, ADR 0009, CLAUDE.md, ownership gate | 🔄 in progress |
| 1 | Parallel: farsi+grader, session engine+srs+game rules, database, UI kit, content CLI + AI client | ⏳ |
| 2 | Parallel: API, pages, lesson player, 13 challenge renderers, path + letters; AI content; QA → tag `mvp` | ⏳ |
| 3 | Leagues, quests, coins/shop, practice hub, Persian keyboard + typing, letter tracing | ⏳ |
| 4 | Stretch: speak, stories, placement, offline, energy, Plus/email/push behind flags | ⏳ |
| 5 | Hardening: security + code review, audits, docs sync, deploy runbook | ⏳ |

## Workstreams

| ID | Wave | Owns | Status | PR |
|---|---|---|---|---|
| ws-farsi-grader | 1 | `packages/farsi`, `packages/grader` | ⏳ | |
| ws-engine | 1 | `packages/session-engine`, `srs`, `game-rules` | ⏳ | |
| ws-db | 1 | `supabase/migrations`, `packages/db` | ⏳ | |
| ws-ui | 1 | `packages/ui` | ⏳ | |
| ws-content-cli | 1 | `packages/ai`, `tools/content-cli` | ⏳ | |
| ws-api | 2 | `apps/web/app/api`, `apps/web/lib/server` | ⏳ | |
| ws-pages | 2 | onboarding, profile, settings, admin, marketing, PWA | ⏳ | |
| ws-player | 2 | lesson player | ⏳ | |
| ws-renderers | 2 | 13 challenge renderers | ⏳ | |
| ws-path-letters | 2 | path, letters | ⏳ | |
| ws-content-gen | 2 | `content/fa-en` (orchestrator, uses the AI key) | ⏳ | |
| ws-qa-N | 2+ | `e2e/` | ⏳ | |

## AI spend

Key limit $10 (hard cap $9.50 enforced by the content CLI). Spent so far: $0.00.

## Human-review backlog (cannot be automated honestly)

- Native-speaker review of all course content and audio (every item is `status: draft`).
- Art director approval of the style bible and generated art.
- A Rive animator for the character rigs (placeholders are SVG).
- Legal review: trade dress; sanctions before contracting anyone in Iran.
- Accounts for deployment: Supabase, Vercel, Stripe, email provider, Turnstile, domain.
- More OpenRouter credit for Units 2–5 media (the key's limit is $10).
- Add `OPENROUTER_API_KEY_BUILD` / `OPENROUTER_API_KEY_APP` to the environment settings so the key survives this container.
