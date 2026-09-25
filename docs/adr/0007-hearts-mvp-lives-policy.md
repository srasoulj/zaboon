# ADR 0007: Hearts in the MVP, behind a `LivesPolicy` seam

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

Duolingo's classic mechanic is **hearts**: a limited number of mistakes, refilled over time. In
July 2025 Duolingo moved its mobile apps to **energy**, where every exercise costs energy, correct
streaks refund some, and reviewing mistakes at the end is free. Energy is more complex, and its
value for a new course is unproven.

## Decision

- Define a `LivesPolicy` interface in `packages/game-rules`.
- **The MVP implements hearts:**
  - 5 max, and −1 per wrong attempt.
  - Wrong attempts are sent as idempotent events keyed on `(session_id, attempt_seq)`, through the client outbox. A re-queued retry gets a new sequence number and still costs a heart.
  - At commit, server-graded wrong answers whose events never arrived are also charged.
  - Hearts regenerate lazily over time, and a practice session earns one back.
- **P2:** coins refill hearts and Zaboon Plus makes them unlimited. **Energy** is implemented behind the same interface for an A/B experiment. Its cost would be reserved when a session starts and settled at commit, so it needs no calls for each challenge.

## Alternatives considered

- **Energy first.** It matches Duolingo mobile today, but it's more complex, and it can't be tuned without real usage data.
- **No lives system.** Simpler, but it loses a core motivation loop and the "practice to earn a heart" mechanic.

## Consequences

- **Positive:** a simple, well-understood mechanic for launch, with a clean seam for experiments.
- **Negative:** the lives mechanic can't be A/B tested until P2.
- **Negative:** wrong attempts need small network events (queued and idempotent).
