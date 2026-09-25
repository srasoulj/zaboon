# Normalizer and grader oracles (read-only)

Expected-behaviour tables for `@zaboon/farsi` (`packages/farsi/oracles/normalize.yaml`) and `@zaboon/grader`
(`golden.yaml`, here); rules: docs/LEARNING-ENGINE.md §1.5, §3, §7 as pinned in each file's header. Owned by the
orchestrator and **read-only** (`**/oracles/**` is protected in `ops/ownership.json`): farsi/grader workers must make
every case pass and must not edit, skip or delete cases; raise a suspect case with the orchestrator. Strings are
double-quoted; ZWNJ is `\u200C`; other invisible characters, combining marks and look-alikes are `\uXXXX` escapes.

- `normalize.yaml` `{id, input, normalized, loose, note}`: `normalize(input)` = `normalized`, `looseKey(input)` = `loose`.
- `golden.yaml` `{id, lang, mode, accept, formal?, pronounDrop?, variants?, lexicon?, answer, expect, closest?, note}`:
  `grade(compile(accept, {lang, formal, pronounDrop, variants}), answer, {lang, mode, lexicon}).verdict` = `expect`.
  `lang` = answer language; `mode: bank` = space-joined word-bank tiles; `accept` = §3.1 patterns; `formal` = faFormal;
  `pronounDrop` defaults to true; `variants` = orthography variant sets; `lexicon` = other course words (a same-sound
  swap or typo landing exactly on one is `wrong`); `note` is free text. `closest`, if present, must equal `closestSolution`
  keyed: `looseKey` for fa; for en lowercase, U+2019/U+2018/U+02BC as `'`, contractions expanded, US spelling, digits.
