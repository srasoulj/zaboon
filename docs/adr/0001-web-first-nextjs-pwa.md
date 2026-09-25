# ADR 0001: Web-first Next.js PWA with a client-rendered learner app

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The product owner wants **a web version only for now**, with native apps possibly later. The app
is highly interactive, like Duolingo: animated tiles, instant feedback, sound, and characters. It
also needs SEO-friendly marketing pages ("learn Persian", alphabet pages) to acquire learners. The
team is small.

## Decision

- **Next.js (App Router) + React + TypeScript**, deployed on **Vercel**.
- Marketing and SEO pages are **statically generated**. The **learner app is client-rendered**: client components, supabase-js in the browser, and Bearer tokens to our route handlers.
- The app is an installable **PWA**. A Serwist service worker caches hashed app assets and immutable `/v{N}/` content bundles.
- API **route handlers** live in the same Next.js app and set `preferredRegion` to the Supabase database's region.
- Domain logic (`farsi`, `grader`, `session-engine`, `srs`, `game-rules`, `content-schema`) lives in **DOM-free packages**, enforced by a lint rule, so a native app can reuse it.

## Alternatives considered

- **Vite SPA + a separate marketing site + a separate API.** A simpler mental model for the app, but three deployables instead of one.
- **Expo / React Native Web.** It would share code with future native apps, but the web experience (styling, accessibility, SEO, bundle size) is weaker than React DOM.
- **Flutter web.** Canvas rendering hurts text selection, RTL text rendering, accessibility and SEO, all of which matter for a reading-heavy Persian course.

## Consequences

- **Positive:** one deployable for marketing, app and API; excellent web ergonomics; a large hiring pool.
- **Positive:** native apps later can reuse all domain packages, through either Expo or a Capacitor wrapper around the PWA.
- **Negative:** App Router server/client boundaries add complexity. Keeping the learner app client-rendered and using Bearer tokens (not `@supabase/ssr` cookies) sidesteps most of it.
- **Negative:** native apps will still need a new UI layer.
