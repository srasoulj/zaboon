# ADR 0004: Persian script from day 1, with a per-token transliteration fade

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

- Reading the Perso-Arabic script is essential for real literacy, but it's a big hurdle for English speakers: it's right-to-left, letters change shape by position, and short vowels are usually not written.
- Heritage learners often speak Persian but can't read it.
- Duolingo teaches non-Latin scripts with a dedicated letters tab, word-bank answers and a romanization toggle.

## Decision

- **Script from day 1.** A **Letters tab** runs parallel to the path. It starts with the non-connecting letters ا د ر ز و, then frequent connectors, then the rest by shape family.
- **Transliteration** is shown as a line under each token, fading **per token**. A word keeps its transliteration while it's new or contains letters the learner hasn't mastered, according to `letter_memory` (FSRS). A gear icon in the lesson forces it on or off. Short-vowel marks (`faVocalized`) follow the same rule.
- **Output:** Persian answers go through the **word bank** in the MVP. Typing Persian with an in-app `PersianKeyboard` (standard and phonetic layouts) comes in P2.
- **Heritage fast track:** "I speak but can't read" routes to the Letters tab plus reading-heavy sessions.

## Alternatives considered

- **Transliteration first, script later.** Quicker early wins, but a painful transition and weaker reading skills.
- **Script only.** Too steep for beginners, and pronunciation suffers without a scaffold.

## Consequences

- **Positive:** real literacy; a strong fit for heritage learners; the scaffolding adapts to each learner.
- **Negative:** per-token rendering is more complex. It must **never split a word** into styled spans, because that breaks letter joining (especially in WebKit), so tiles and diffs work on whole words.
