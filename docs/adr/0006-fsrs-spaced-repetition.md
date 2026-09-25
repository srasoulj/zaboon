# ADR 0006: FSRS for spaced repetition

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The app needs a per-learner memory model for three things:

- mixing due reviews into sessions;
- Practice and Mistakes sessions and word-strength bars;
- the per-token transliteration fade ([ADR 0004](0004-script-first-transliteration-fade.md)).

Duolingo's published Half-Life Regression (2016) and its later "Birdbrain" model need large
training datasets we don't have yet.

## Decision

- Use **FSRS** through [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) (MIT, FSRS-6), wrapped in `packages/srs`.
- Keep one card for each (user, lexeme) in `lexeme_memory` and each (user, letter) in `letter_memory`.
- Aggregate outcomes once per session per item and apply them at commit, on the server: any wrong attempt → Again; correct but slow or hinted → Hard; clean → Good.
- Retrievability drives the strength bars and the transliteration fade. Thresholds live in `app_config`.

## Alternatives considered

- **Half-Life Regression.** Proven at Duolingo, but it needs training data to fit its weights.
- **Leitner boxes.** Simple, but crude scheduling.
- **A custom model.** Unnecessary risk at this stage.

## Consequences

- **Positive:** a proven open-source scheduler in TypeScript that runs on client and server; no training data needed on day one.
- **Negative:** ratings inferred from exercise outcomes are noisier than explicit self-ratings. FSRS parameters should be re-tuned once review data accumulates.
