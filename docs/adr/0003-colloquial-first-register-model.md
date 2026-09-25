# ADR 0003: Colloquial-first register model

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

Persian has strong diglossia. Everyday speech (colloquial Tehrani: *mikhām*, *nemidunam*,
*zabun*) differs markedly from the written standard (*mikhāham*, *nemidānam*, *zabān*). Most
English-speaking learners want to talk with family, partners and friends, or to travel, and
many are heritage learners. Formal Persian is still needed for reading. The product name,
*Zaboon*, is itself colloquial.

## Decision

- **Teach colloquial (Tehrani) Persian first**, with formal/written forms layered alongside.
- **Data:** every Persian item stores colloquial `fa` and, when it differs, `faFormal`, each with its own transliteration.
- **Display:**
  - Colloquial is shown by default, with a "written: …" chip when the formal form differs.
  - Units can set `register: formal` to flip the default (later units on signs, news, poetry).
- **Grading:** the grader accepts both registers and shows the "Correct solution" in the register the learner used.
- **Spelling:** colloquial written spelling isn't standardized. It is governed by `content/fa-en/STYLE.md` plus a course-wide `orthography-variants.yaml`, which is merged into every answer graph.

## Alternatives considered

- **Formal/written only.** Simpler TTS and grading, but learners sound bookish and struggle to understand real speech.
- **Two separate tracks.** Cleaner separation, but roughly twice the content work.

## Consequences

- **Positive:** learners understand and speak real Persian from day one, and the course differs clearly from generic courses.
- **Negative:** non-standard colloquial spelling needs a style guide and variant acceptance.
- **Negative:** TTS may mispronounce colloquial spellings. Mitigation: synthesize from `faVocalized`, require native sign-off, and record core sentences with voice actors.
