# Zaboon (زبون)

**Learn Persian (Farsi) the fun way.** Zaboon is a Duolingo-style web app that teaches Persian to
English speakers. It has bite-sized lessons on a learning path, word-bank tiles, hearts, streaks
and XP, with its own Persian-inspired look, an original mascot (Hodhod the hoopoe) and a cast of
characters.

*Zaboon* is the colloquial Tehrani pronunciation of *zabān*, "language".

> **Status: under construction.** Implementation is running in waves (see
> [docs/PROGRESS.md](docs/PROGRESS.md)). Run `pnpm install && pnpm verify` to check a checkout.

## What makes it different

- **Colloquial first.** Learners speak real, everyday Tehrani Persian from day one, with formal/written forms layered alongside.
- **Script from day 1.** A Letters tab plus transliteration that fades word by word as each letter is mastered.
- **Grading built for Persian.** Arabic/Persian letter variants, half-space (ZWNJ) spelling, letters that sound the same, and both registers are all handled.
- **A heritage fast track** for learners who speak Persian but can't read it.

## Documentation

| Document | What's inside |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System overview, data model, game rules, API, jobs, security, key flows, AI integration, environments, roadmap |
| [Design system](docs/DESIGN-SYSTEM.md) | Layout and screens, the learning path, design tokens, typography, components, characters and asset generation, sound and motion |
| [Learning engine](docs/LEARNING-ENGINE.md) | Persian text handling, content model, accepted-answer patterns, content pipeline, session engine, challenges, grader, spaced repetition |
| [Decision records](docs/adr/) | Why each major decision was made |

### Decision records

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-web-first-nextjs-pwa.md) | Web-first Next.js PWA with a client-rendered learner app |
| [0002](docs/adr/0002-supabase-server-authoritative-writes.md) | Supabase, with server-authoritative transactional writes in TypeScript |
| [0003](docs/adr/0003-colloquial-first-register-model.md) | Colloquial-first register model |
| [0004](docs/adr/0004-script-first-transliteration-fade.md) | Persian script from day 1, with a per-token transliteration fade |
| [0005](docs/adr/0005-content-as-code-immutable-bundles.md) | Content as code, compiled to immutable versioned bundles |
| [0006](docs/adr/0006-fsrs-spaced-repetition.md) | FSRS for spaced repetition |
| [0007](docs/adr/0007-hearts-mvp-lives-policy.md) | Hearts in the MVP, behind a `LivesPolicy` seam |
| [0008](docs/adr/0008-ai-via-openrouter.md) | All AI through OpenRouter, with separate build and app keys |
| [0009](docs/adr/0009-api-first-data-access.md) | API-first data access: every read and write goes through route handlers, and the browser uses Supabase only for Auth (amends 0002) |

## Planned stack

| Layer | Choice |
|---|---|
| Web app | Next.js (App Router) + React + TypeScript on Vercel; installable PWA |
| UI | Tailwind CSS v4 on design tokens, Motion, Rive characters, Howler.js |
| Backend | Supabase: Postgres + RLS, Auth, Storage + CDN, pg_cron |
| Content | YAML in git → validated → immutable versioned bundles on a CDN |
| AI | OpenRouter: `openai/gpt-6-astra` for course materials, `openai/gpt-5.4-image-2` (latest GPT Image) for assets; separate build and app keys |
| Learning | FSRS spaced repetition (`ts-fsrs`), a Persian-aware grader |
| Ops | Amplitude, Sentry, GitHub Actions, Vercel Cron |

## Planned repository layout

```
apps/web/            Next.js learner app, marketing pages and API route handlers
packages/            ui · farsi · grader · content-schema · contracts · session-engine · srs · game-rules · db · ai · config
content/fa-en/       the course: units, lexemes, sentences, letters, guidebooks, style bible, assets
tools/content-cli/   draft · suggest · art · tts · audio · validate · build · publish · models
supabase/            migrations, RLS, pgTAP tests
docs/                architecture, design system, learning engine, ADRs
```

## Roadmap

| Phase | Scope |
|---|---|
| **0 — Foundations** | Monorepo, CI/CD, Supabase, UI kit, Persian text + grader packages, content pipeline, one unit of content, a walking skeleton |
| **1 — MVP (public beta)** | Section 1 (~5 units), 13 challenge types, the Letters tab, XP, streaks, hearts, guest → profile, reports |
| **2 — Engagement and revenue** | Leagues, quests, coins and shop, Zaboon Plus, Persian keyboard, speaking, stories, reminders |
| **3 — Scale** | Studio authoring app, AI roleplay, friends, A2–B1 content, native apps |

## Secrets

Never commit keys. [`.env.example`](.env.example) lists the variable names only. Copy it to
`.env.local`, which is git-ignored. The two OpenRouter keys are deliberately separate:
`OPENROUTER_API_KEY_BUILD` for the content pipeline, and `OPENROUTER_API_KEY_APP` for the app's
server.
