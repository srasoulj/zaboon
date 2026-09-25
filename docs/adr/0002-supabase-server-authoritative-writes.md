# ADR 0002: Supabase with server-authoritative, transactional writes in TypeScript

- **Status:** Accepted
- **Amended by:** [ADR 0009](0009-api-first-data-access.md): reads also go through route handlers (replacing the "Reads" bullet below), and handlers verify JWTs against the JWKS with `jose`
- **Date:** 2026-09-25

## Context

Streaks, XP, hearts and (later) leagues must be trustworthy: two tabs, retries and replayed
requests must never lose or double-count progress. The same rules (XP, streak day math, hearts,
FSRS) are needed on the client for optimistic display and on the server for truth. The product
owner chose **Supabase**.

## Decision

- **Supabase** provides Postgres, Auth (anonymous guest → linked account), Storage + CDN and pg_cron.
- **Reads:** the browser reads through supabase-js under **RLS**. Anonymous and authenticated roles have **no write grants** on game tables; only a few user-editable columns (display name, avatar, settings) get a column-level `GRANT UPDATE`.
- **Writes:** every game-state change goes through a Next.js route handler. The handler:
  - verifies the Bearer JWT with `getClaims()`;
  - opens **one Postgres transaction** (Drizzle over postgres.js through the Supavisor transaction pooler with `prepare: false`, connecting as a dedicated non-superuser `app_server` role);
  - takes `pg_advisory_xact_lock(user)`;
  - loads state `FOR UPDATE`, runs the shared **TypeScript** rules, writes, and commits.
- **Idempotency:**
  - wrong-attempt events are unique on `(session_id, attempt_seq)`;
  - a completed session stores its `result`, and a replay returns it verbatim.
- **pg_cron** is used only for pure-SQL housekeeping. Jobs that use game rules or external services run in Node through Vercel Cron.

## Alternatives considered

- **SQL RPC functions for commits.** This splits the rules across TS (FSRS, game rules) and SQL. The handler would read, compute in TS, then call the RPC, and two concurrent requests could each read the same state and overwrite each other.
- **Direct client writes guarded by RLS.** Trivially cheatable for XP and leaderboards.
- **Firebase.** A NoSQL model makes leaderboards, streak history and analytics queries harder; the owner chose Supabase.

## Consequences

- **Positive:** exactly one implementation of each rule; atomic, race-free commits; easy unit tests for pure TS rules.
- **Negative:** the server manages Postgres connections through the pooler.
- **Negative:** the Drizzle schema must stay in sync with the SQL migrations; CI runs a drift check.
- **Negative:** writes don't use PostgREST.
- **Follow-up:** pgTAP tests must prove that anon/authenticated cannot write game tables or execute server-only functions.
