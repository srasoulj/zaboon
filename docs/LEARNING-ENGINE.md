# Zaboon — Learning Engine

> Status: **proposed** · Last updated: 2026-09-25 · See also: [Architecture](ARCHITECTURE.md) · [Design system](DESIGN-SYSTEM.md)

This document covers everything between a native speaker's head and a learner's answer being
marked correct:

- how Persian text is represented, rendered, typed and normalized;
- how the course is modeled, drafted, reviewed and released;
- how sessions are built;
- how answers are graded;
- how memory is tracked.

## Contents

1. [Persian language layer](#1-persian-language-layer)
2. [Content model](#2-content-model)
3. [Accepted-answer patterns](#3-accepted-answer-patterns)
4. [Content pipeline and release](#4-content-pipeline-and-release)
5. [Session engine](#5-session-engine)
6. [Challenge catalogue](#6-challenge-catalogue)
7. [Grader](#7-grader)
8. [Spaced repetition](#8-spaced-repetition)

---

## 1. Persian language layer

This layer lives in `packages/farsi` (pure TypeScript, no DOM) and in the `FaText` component in
`packages/ui`.

### 1.1 How text is represented

Every Persian string in content carries:

| Field | Example | Notes |
|---|---|---|
| `fa` | می‌خوام | Colloquial script: the default display form |
| `faFormal` | می‌خواهم | Formal/written script, **only when it differs** |
| `translit` / `translitFormal` | mikhām / mikhāham | Hand-authored romanization (§1.6) |
| `faVocalized` | مَن آب می‌خوام | With short-vowel marks. Shown to beginners and used as TTS input |
| `tokens[]` | `{surface, lexemeId, translit, gloss}` | Powers tap-for-hint, per-word audio and the word bank |

### 1.2 Register display

Persian has a large gap between how it's spoken and how it's written. Zaboon teaches the spoken
form first (see [ADR 0003](adr/0003-colloquial-first-register-model.md)).

- **Colloquial is shown by default.** When `faFormal` differs, a small "written: …" chip appears under the sentence. Tapping it expands the formal form, and plays formal audio if it was recorded.
- **A unit can set `register: formal`**, for example later units on signs, news and poetry. That flips the default.
- **The grader accepts both registers** wherever `faFormal` exists, and the "Correct solution" is shown in the register the learner used.
- **Colloquial pronunciation:** in Tehrani speech, *-ān* often becomes *-un* and *-ām* becomes *-um*: نان nān → نون nun ("bread"), بادام bādām → بادوم bādum ("almond"). This is also where the app's name comes from: زبان zabān → زبون zabun, spelled "Zaboon" for English readers.

### 1.3 Rendering

- **Direction:**
  - Persian blocks are RTL islands inside an English (LTR) app. `FaText` renders `lang="fa" dir="rtl"` and wraps mixed strings in `<bdi>`.
  - CSS logical properties are used everywhere.
  - The answer line and any inputs take their direction from the challenge's **answer language**, set explicitly. `dir="auto"` isn't enough because it starts left-to-right while the field is empty.
- **Tiles:**
  - Tiles are **whole whitespace-delimited words**. A half-space compound such as می‌خوام stays one tile. Tiles use `white-space: nowrap`.
  - **Never style part of a Persian word.** Wrapping letters in separate spans breaks letter joining, especially in WebKit, so feedback diffs highlight whole words.
- **Transliteration:**
  - Shown as a line under each token, which is how Duolingo displays Arabic.
  - In `auto` mode it's decided per token: transliteration shows while the word is new or contains letters the learner hasn't mastered yet (§8).
  - A gear icon inside the lesson forces it on or off. Vowel marks follow the same rule.
- **Letter forms:** each letter's contextual forms are rendered with **ZWJ** (U+200D): initial = `X + ZWJ`, medial = `ZWJ + X + ZWJ`, final = `ZWJ + X`. No deprecated presentation-form code points are needed.
- **Digits:** Persian content shows Persian digits (۱۲۳); the English UI shows Western digits.

### 1.4 Input

- **MVP:** Persian output goes through the **word bank**, which is Duolingo's approach for non-Latin scripts. Typed answers are English only.
- **P2: an in-app `PersianKeyboard`** with two layouts:
  - **Standard** (ISIRI 9147).
  - **Phonetic**, grouped by sound, with long-press variants: z → ز ذ ض ظ · s → س ص ث · t → ت ط · h → ه ح · gh → غ ق.
  - A dedicated half-space key.
- **Physical keys:** a key is remapped by `event.code` only when `event.key` is a Latin character and `!event.isComposing`. That leaves OS Persian layouts and IMEs untouched, and avoids Android's `keyCode 229` problem.
- **Touch devices:** Persian inputs use `inputmode="none"` and show the on-screen keyboard.

### 1.5 Normalization pipeline

One ordered, **versioned** pipeline runs on learner answers at runtime and on answer keys at
build time, so both sides are always compared in the same form.

| # | Step | Details |
|---|---|---|
| 1 | NFC | Unicode normalization. It runs first, because mapping letters before NFC breaks decomposed ئ |
| 2 | Letter map | ي/ى → ی and ك → ک. For comparison only, ە/ة → ه |
| 3 | Folds | ۀ ↔ هٔ ↔ ه (ezāfe); ئی ↔ یی (پائیز/پاییز); أ/إ/ٱ → ا. Mixing up آ and ا counts as a typo (§7) |
| 4 | Strip | Bidi controls (U+200E/F, U+202A–E, U+2066–9), BOM (U+FEFF), ZWSP (U+200B), tatweel (U+0640), diacritics (U+064B–U+0652, U+0670) |
| 5 | Digits | Persian, Arabic-Indic and ASCII digits form one class. The grader also treats number words and digits as equal |
| 6 | Spaces | NBSP → space. A **loose key** drops ZWNJ and the spaces next to known affixes: می/نمی, ها/های/ا, ی/ای, تر/ترین, and the clitics ام/ات/اش/مان/تان/شان |
| 7 | Punctuation | Strip ، ؛ ؟ « » . ! ? |

- **Implementation:**
  - `@persian-tools/persian-tools` (MIT) provides `toPersianChars`, `halfSpace` and the `digits*` helpers.
  - The regex tables from Hazm's `constants.py` (MIT) are ported into `packages/farsi`: `AFFIX_SPACING_PATTERNS`, `TRANSLATION_SRC/DST`, `DIACRITICS_PATTERNS`, `SUFFIXES`.
- **Content lint:** `fa` fields may not contain ي, ك, Arabic-Indic digits, or the ASCII characters `? ; ,`.
- **Versioning:** the pipeline version is part of `graderVersion`.

### 1.6 Romanization

The scheme is learner-friendly and pronunciation-based. It's **hand-authored** for each item,
because the script leaves out short vowels.

| Sound | Written | Example |
|---|---|---|
| a as in *cat* | a | من **man** "I" |
| e as in *bed* | e | اسم **esm** "name" |
| o as in *go* (short) | o | تو **to** "you" |
| ā as in *father* | ā | آب **āb** "water" |
| i as in *machine* | i | این **in** "this" |
| u as in *food* | u | نون **nun** "bread" |
| ey as in *day* | ey | کی **key** "when?" |
| ow as in *low* | ow | نو **now** "new" |
| consonant clusters | kh, gh, sh, zh, ch | خوب **khub**, قند **ghand**, شب **shab**, ژاکت **zhākat**, چای **chāy** |
| glottal stop (ع/ء), only where audible | ' | معنی **ma'ni** "meaning" |

**Letters that share a sound share one romanization:** س ص ث → s · ز ذ ض ظ → z · ت ط → t ·
ح ه → h · غ ق → gh. The script teaches the difference.

**Colloquial orthography** — how to write می‌خوام, نمی‌دونم, کتابا and so on — is defined in
`content/fa-en/STYLE.md`.

---

## 2. Content model

### 2.1 Hierarchy

```
Course  fa-en
└─ Section   (CEFR-aligned: Section 1 ≈ A1)
   └─ Unit   (e.g. Greetings & ta'ārof, Family, Food, Numbers & bazaar)
      └─ Level   (a path node: lesson | story | practice | chest | unit_review)
         └─ Lesson session   (about 12–15 challenges, 3–5 minutes)
```

**Section 1 outline** (placeholder, to be finalized with native writers):

| Unit | Theme | Sample phrases |
|---|---|---|
| 1 | Hello & ta'ārof | سلام salām · خداحافظ khodāhāfez · مرسی mersi · بفرمایید befarmāyid |
| 2 | About me | من … هستم man … hastam · خوبی؟ khubi? |
| 3 | Family | مامان māmān · بابا bābā · خواهر khāhar · برادر barādar |
| 4 | Food & tea | نون nun · آب āb · چای chāy · برنج berenj · ته‌دیگ tahdig |
| 5 | Numbers & the bazaar | یک yek · دو do · سه se · چنده؟ chande? · گرونه! gerune! |

### 2.2 Letters track

The Letters tab runs parallel to the path.

1. Like Duolingo's Arabic course, it **starts with letters that don't change shape**, the non-connectors ا د ر ز و (ذ and ژ come later with their shape families).
2. Then frequent connectors: ب م ن ی ت س …
3. Then the rest by shape family: ب پ ت ث · ج چ ح خ · س ش · ص ض · ط ظ · ع غ · ف ق · ک گ.
4. Along the way it covers long versus short vowels, the vowel marks, the ezāfe, and the half-space.

Heritage learners who answer "I speak but can't read" start here (the heritage fast track).

### 2.3 Entities

All entities are defined as zod schemas in `packages/content-schema`, with TS types generated
from them.

- **Every entity** carries a `status` (`draft` → `approved`) and a `provenance`: either the human author, or the model ID + prompt version. **Only approved items can be published.**
- **Unit:** `register`, `color`, guidebook, levels.
- **LessonSpec:** focus lexemes and sentences, an exercise-mix profile (§5), and optional hand-pinned challenges.
- **Character:** name, voice, personality guide, Rive asset.
- **Guidebook:** markdown with embedded `<fa audio>` phrases.
- **Story** (P2).

A **lexeme**:

```yaml
- id: lx_ab
  fa: آب
  translit: āb
  pos: noun
  glosses: [water]
  image: img/water
  audio: au/lx_ab
  introducedIn: u04-food
  status: approved
  provenance: { author: writer-01, reviewedBy: native-02 }
```

A **sentence**. Note how little the Persian pattern needs to spell out; see §3.2.

```yaml
- id: s_u04_0007
  fa: من آب می‌خوام
  faFormal: من آب می‌خواهم
  faVocalized: مَن آب می‌خوام
  translit: man āb mikhām
  translitFormal: man āb mikhāham
  tokens:
    - { surface: من, lexeme: lx_man, translit: man, gloss: I }
    - { surface: آب, lexeme: lx_ab, translit: āb, gloss: water }
    - { surface: می‌خوام, lexeme: lx_khastan, translit: mikhām, gloss: "(I) want" }
  en: "[I want/I'd like] [some/] water"
  faAccept: "من آب می‌خوام"
  audio: { speaker: leila }
  unit: u04-food
  status: draft
  provenance: { model: openai/gpt-6-astra, prompt: draft-sentences@3 }
```

A **letter**:

```yaml
- id: l_be
  letter: ب
  name: be
  translit: b
  ipa: b
  connects: true
  examples: [lx_baba, lx_ab]
  audio: au/l_be
```

A **unit**:

```yaml
id: u04-food
title: Food & tea
register: colloquial
color: zaferan
guidebook: guidebooks/u04-food.md
levels:
  - { id: u04-l1, kind: lesson, lessons: 4, spec: specs/u04-l1.yaml }
  - { id: u04-l2, kind: lesson, lessons: 4, spec: specs/u04-l2.yaml }
  - { id: u04-c1, kind: chest }
  - { id: u04-p1, kind: practice }
  - { id: u04-review, kind: unit_review }
```

**IDs never change.** When levels are restructured, a `pathMigrations` map in the bundle moves
learner progress to the new structure.

---

## 3. Accepted-answer patterns

### 3.1 Syntax

- Tokens are separated by spaces. Persian tokens keep their half-space (می‌خوام is one token).
- `[a/b/c]` means exactly one of the alternatives. An alternative can be several words: `[I want/I'd like]`.
- An empty alternative makes the group optional: `[some/]`.
- Groups don't nest. For a different sentence structure, add another pattern; `en` and `faAccept` also accept a list.
- Escape the syntax characters with `\[`, `\]` and `\/`.

```yaml
en:
  - "[I want/I'd like] [some/] water"
  - "water, please"
```

### 3.2 Automatic merges

`grader` compiles each item's patterns into a **token DAG** (directed acyclic graph). These are
merged into every DAG automatically, so authors never write them by hand:

1. **Normalization** (§1.5) is applied to both keys and answers.
2. **Register:** when `faFormal` exists, its tokens are merged as alternatives, aligned by token. When the alignment isn't one-to-one, it's added as an extra pattern.
3. **Pronoun drop:** Persian verbs carry the subject, so a sentence-initial subject pronoun becomes optional: من, تو, او, ما, شما, آنها, and the colloquial اون, اونا. Setting `pronounDrop: false` turns this off, for example for contrastive emphasis.
4. **Orthography variants** come from a course-wide `orthography-variants.yaml`. For example:
   ```yaml
   - [می‌خوام, می‌خام]
   - [کتابا, کتاب‌ها]
   - [اینو, این رو]
   - [چیکار, چی کار]
   ```
5. **English normalization** covers contractions (I'm ↔ I am), US/UK spellings, and number words ↔ digits.

So the authored Persian pattern `من آب می‌خوام` also accepts `آب می‌خوام`, `من آب می‌خواهم`,
`آب میخوام`, `من آب می‌خام` and so on.

### 3.3 Compilation checks

`content-cli validate` enforces the following:

- every pattern compiles;
- the canonical `fa` and `en` sentences are accepted by their own DAGs;
- DAG size stays within limits (at most 5,000 paths);
- no word-bank distractor can complete a valid answer.

Golden tests in `content/fa-en/tests/grading.yaml`, seeded from real learner reports, pin the
grader's behavior.

---

## 4. Content pipeline and release

All commands live in `tools/content-cli`. AI commands use OpenRouter with the **build key**
(`OPENROUTER_API_KEY_BUILD`); see [Architecture §11](ARCHITECTURE.md#11-ai-integration-openrouter).

### 4.1 Authoring commands

The content team runs these. They are AI-assisted, and a human approves every result.

1. **`draft`** uses **`openai/gpt-6-astra`** to generate course materials from a unit brief (theme, target grammar, allowed lexemes). It produces:
   - candidate sentences, dialogues and `complete_chat` items;
   - guidebook drafts, glosses and English translations;
   - `faVocalized` and transliteration drafts.

   The output is zod-validated structured JSON, written as `status: draft` YAML. A native writer edits and approves it.
2. **`suggest`** (same model) drafts accepted-answer variants and word-bank distractors. **A native reviewer must approve every variant before it's merged.** Duolingo uses the same "LLM draft + expert review" approach and averages 200+ accepted answers per exercise, so hand-writing variants alone won't scale.
3. **`art`** generates character and illustration assets with `openai/gpt-5.4-image-2`, the latest GPT Image model (see [Design system §7.4](DESIGN-SYSTEM.md#74-asset-generation-gpt-image-via-openrouter)).
4. **`tts`** synthesizes draft audio with `openai/gpt-audio`, one voice per character.
   - It works from **`faVocalized`**, because vowel marks disambiguate words such as کرد (kard "did" / kord "Kurd") and مرد (mard "man" / mord "died").
   - The cache key is `hash(model, voice, input text, prompt version)`.
   - Recordings always override TTS, and every clip needs native sign-off.
   - It's **gated by a native listening test**: OpenRouter has no dedicated Persian voices, and gpt-audio's voices are tuned for English. If the test fails, the fallback is Azure's native fa-IR voices, which needs the project owner's approval because it's outside OpenRouter.
5. **`audio`** normalizes loudness to −16 LUFS and encodes mono 64 kbps MP3 files with content-hashed names. It also pre-renders:
   - a **0.7× "turtle" clip** (ffmpeg `atempo`, which keeps the pitch);
   - the **amplitude envelope** JSON that drives character lip-sync.
6. **`models check`** queries OpenRouter's model list and flags newer versions of the pinned models, such as a newer GPT Image.

### 4.2 AI guardrails

- Model IDs are pinned in `packages/ai/ai.models.yaml`; `~latest` aliases are never used.
- Responses are cached by `hash(model, prompt version, input)`, so reruns are free and reproducible.
- Bulk text runs use the `:batch` variant, which is half price.
- The build key has its own OpenRouter credit limit. The key available today has a $10 limit, so AI media is produced for Unit 1 first.
- **Nothing AI-generated is published without human approval.** `validate` rejects anything still in `status: draft`.

### 4.3 Release commands (CI)

1. **`validate`** checks that:
   - schemas pass;
   - only `approved` items are included;
   - every token maps to a lexeme introduced at or before its unit;
   - every pattern compiles and accepts its canonical answer (§3.3);
   - no distractor can form a valid answer;
   - all media exists and has been signed off;
   - IDs are unique and stable;
   - the normalization lint (§1.5) passes.
2. **`build`** emits `manifest.json`, one bundle per unit, a letters bundle, guidebooks and `pathMigrations`.
3. **`publish`** uploads `/v{N}/` (immutable) to Storage and inserts a `content_versions` row. Making it current is a separate, approved step.

**Fixture course:** `content/fixtures` holds a frozen course that covers all 13 MVP challenge
types (§6). End-to-end tests run on it, never on AI-generated content, so they don't change when
the real course is redrafted. `validate --fixtures` checks it strictly in CI.

### 4.4 Release process

1. A content PR runs `validate` in CI, and a preview route renders every changed item: text, audio, accepted answers and art.
2. A native reviewer approves (`CODEOWNERS` on `content/`), and the PR merges.
3. vN is published to **staging** and goes through QA.
4. After manual approval, the same vN is published to production and `is_current` is set.

**Rollback:** republish the previous content as vN+1. Never move the pointer backwards past a
path migration.

**Other tooling:** a CSV/Sheets importer for bulk vocabulary is optional. A Studio web app (P3)
will emit the same bundle format, so the app is unaffected.

### 4.5 Report loop

In a lesson, the learner can report "My answer should be accepted", an audio issue or a mistake
in the content. The report lands in the `reports` table. It's then:

1. triaged in the `/admin` view;
2. fixed with a pattern or variant change in a content PR;
3. republished;
4. marked `accepted`.

Accepted reports are added to the grader's golden tests. In P2, the learner can be notified that
their answer is now accepted.

---

## 5. Session engine

The session engine lives in `packages/session-engine` and is **deterministic by seed**.

- **When it runs:** a session is generated **when the learner taps a node**, not prefetched. Only the next lesson's bundle and media are prefetched while the path is on screen.
- **Inputs:** the LessonSpec, the learner's FSRS states, open mistakes, and the level position.
- **Output:** an ordered `Challenge[]` containing every text, choice, answer graph and media URL the player needs. It's stored compactly as `vN + seed + challenge_refs` with a 24-hour TTL, and rebuilt from the immutable bundle when the session is re-graded.
- **Ladder for each new word:**
  1. a NEW WORD intro (`select_image` if the word has a picture, otherwise `select_translation`);
  2. recognition (fa→en);
  3. production (en→fa word bank);
  4. listening (`listen_tap`);
  5. typing, in later levels (P2).
- **Review:** due FSRS items are mixed into every session, up to a configured share of the challenges.
- **Distractors:** same part of speech and similar length, drawn from the current and earlier units. A distractor that appears in any accepted variant is rejected.
- **Wrong answers are re-queued** at the end of the lesson until they're answered correctly. Each retry is a new attempt with its own `attempt_seq`.
- **Legendary sessions:** no hints, and more production and listening.

**Mix profiles** live in `app_config`, so they can be tuned without a deploy. Initial defaults:

```yaml
mixProfiles:
  intro:     { newWord: 0.25, recognition: 0.30, productionBank: 0.20, listening: 0.15, matching: 0.10 }
  standard:  { recognition: 0.25, productionBank: 0.35, listening: 0.25, matching: 0.15 }
  legendary: { productionBank: 0.45, listening: 0.35, recognition: 0.20, hints: false }
reviewShare: 0.3
```

---

## 6. Challenge catalogue

Challenge types form a registry of `{renderer, getResponse, isReady, shortcuts}`, so adding a
type never touches the player. **The MVP has 13 types: 8 course types and 5 letter types.**

| Type | Learner action | Answer | Grading | Phase |
|---|---|---|---|---|
| `select_image` | Pick the picture for a Persian word | choice | exact | MVP |
| `select_translation` | Pick the meaning, either direction | choice | exact | MVP |
| `translate_bank` | Build the translation from tiles (fa→en, en→fa) | tiles (RTL for Persian) | DAG membership | MVP |
| `translate_type` | Type the **English** translation | text | DAG + typo | MVP |
| `match_pairs` | Match 5 Persian↔English pairs | pairs | exact | MVP |
| `listen_tap` | Tap the words you hear (normal, or the pre-rendered 0.7× clip) | Persian tiles | DAG membership | MVP |
| `cloze_choice` | Fill the blank | choice | exact | MVP |
| `complete_chat` | Pick the best reply to a character | choice | exact | MVP |
| `letter_intro` | Meet a letter: name, sound, its four forms | — | — | MVP |
| `letter_sound` | "What sound does this make?" | choice | exact | MVP |
| `letter_forms` | Match a letter's isolated form to its initial, medial and final forms | pairs | exact | MVP |
| `read_word` | Read a short word; pick its transliteration or meaning | choice | exact | MVP |
| `build_word` | Assemble letter tiles into a word and **watch them join** | letter tiles | exact | MVP |
| `translate_type` (en→fa) · `listen_type` · `cloze_type` | Type Persian with `PersianKeyboard` | text | DAG + typo + spelling | P2 |
| `letter_trace` | Trace the letter on a pointer canvas | stroke path | shape tolerance | P2 |
| `speak` | Say the sentence (MediaRecorder); "can't speak now" skips speaking for a while | audio → transcript | lenient DAG | P2 |
| `story` | An illustrated dialogue with comprehension checks | mixed | per question | P2 |
| `roleplay` · `explain_my_answer` | Chat with a character; get an explanation of a mistake | free text | — | P3 |

**`speak` (P2):**
- Speech is transcribed through OpenRouter with the **app key**.
- No service scores Persian pronunciation (Azure's Pronunciation Assessment doesn't support fa-IR), so grading is by transcript.
- Start with `openai/gpt-audio-mini` and benchmark it against a Gemini Flash audio model on real learner recordings.
- Speech audio is processed transiently and not stored.

**`roleplay` / `explain_my_answer` (P3):** they use OpenRouter with the app key:
`openai/gpt-6-sol` for roleplay and `openai/gpt-6-luna` for explanations.

---

## 7. Grader

The grader lives in `packages/grader` and runs **on both client and server**: the client for
instant feedback, the server for consistency.

### 7.1 Verdicts

| Verdict | When | Result |
|---|---|---|
| `correct` | The answer matches the DAG exactly (after normalization) | Correct |
| `typo` | A small edit inside a token: ≤1 edit on tokens of 4+ letters, ≤2 on 8+ (mostly English) | Accepted, with a "typo" note |
| `spelling` | A Persian letter replaced by one that sounds the same, at **any** word length: ز ذ ض ظ · س ص ث · ت ط · ه ح · غ ق · ا/آ | Accepted, with a "watch the spelling" note, **unless the result is another course word** (صد sad "hundred" vs سد sad "dam"), in which case it's wrong |
| `wrong` | A wrong, missing or extra token | Wrong |

The `spelling` verdict exists because the usual typo rule rarely applies to Persian, where most
words are shorter than four letters. Mixing up letters that sound the same is the most common
learner mistake.

### 7.2 Algorithm

1. Normalize the answer (§1.5). The key is normalized at build time.
2. Tokenize on whitespace. A Persian token keeps its half-space.
3. Find the **minimum-cost alignment** between the answer tokens and any path through the DAG, using dynamic programming over (DAG node × answer position).
   - Exact token match: cost 0.
   - `spelling` or `typo` substitution within a token: a small cost.
   - Wrong, missing or extra token: a large cost.
4. The verdict is the worst operation on the best path. A `spelling` substitution that produces another lexeme's surface form becomes `wrong`.
5. Return `{verdict, closestSolution, diff, graderVersion}`:
   - `closestSolution` is the best path, rendered in the register the learner used;
   - `diff` marks **whole words** only.
6. **Word-bank answers** skip the costs: they're checked by exact DAG membership.

### 7.3 Client/server agreement

In `POST /api/sessions/:id/complete`, the server re-grades every completed session against the
stored refs and the immutable bundle. If it disagrees with a verdict the learner already saw, the
learner's verdict stands when their `graderVersion` is in the supported window (the last N), and
the mismatch is logged. Since answer keys ship to the client anyway, re-grading is about
consistency, not secrecy. Anti-cheat relies on plausibility checks in the route handlers, which are
the only path to the database ([Architecture §9](ARCHITECTURE.md#9-security-and-rls)).

---

## 8. Spaced repetition

Memory is tracked with **FSRS** through [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)
(MIT, FSRS-6), in `packages/srs`. See [ADR 0006](adr/0006-fsrs-spaced-repetition.md).

- **What's tracked:** one card for each (user, lexeme) in `lexeme_memory` and each (user, letter) in `letter_memory`.
- **When it updates:** outcomes are aggregated once per session per item and applied at commit, on the server.

  | Session outcome for the item | FSRS rating |
  |---|---|
  | Any wrong attempt | Again |
  | Correct but slow, or after a hint | Hard |
  | Correct and clean | Good |

- **What it drives:**
  - due items in every session (§5), and Practice / Mistakes sessions;
  - the 4-bar **strength indicator** in the Words list, from retrievability: ≥0.9 → 4 bars, ≥0.75 → 3, ≥0.5 → 2, otherwise 1;
  - the **per-token transliteration fade** (§1.3). A token keeps its transliteration while its lexeme has fewer than N exposures, or while any of its letters has retrievability below a threshold or hasn't been introduced yet.
- **Tuning:** all thresholds live in `app_config`. FSRS parameters can be tuned once there's enough review data.
