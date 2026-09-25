# Zaboon — Design System

> Status: **proposed** · Last updated: 2026-09-25 · See also: [Architecture](ARCHITECTURE.md) · [Learning engine](LEARNING-ENGINE.md)

**The goal:** Zaboon should feel instantly familiar to anyone who has used Duolingo. That means the same
layout, the same interaction patterns, the same chunky 3D buttons and the same playful rhythm. But it
must be unmistakably *our own*: a Persian-inspired palette, open-licensed fonts, and an original
mascot and cast.

## Contents

1. [Principles](#1-principles)
2. [Layout and screens](#2-layout-and-screens)
3. [The learning path](#3-the-learning-path)
4. [Design tokens](#4-design-tokens)
5. [Typography](#5-typography)
6. [Component kit](#6-component-kit)
7. [Characters](#7-characters)
8. [Sound, motion and accessibility](#8-sound-motion-and-accessibility)
9. [Boundaries](#9-boundaries)

---

## 1. Principles

1. **Duolingo's structure, Zaboon's identity.** Copy the interaction grammar, never the assets (§9).
2. **Persian is the star.** Persian text is larger, has room for its vowel marks, and is never broken mid-word.
3. **Every tap feels physical.** 3D lips, springy motion, and a sound for each outcome.
4. **Readable for everyone.** WCAG 2.2 AA, keyboard-first on desktop, and reduced-motion support.
5. **Tokens, not hex codes.** Components use semantic tokens only, so dark mode and future themes are free.

## 2. Layout and screens

### 2.1 Breakpoints

| Viewport | Layout |
|---|---|
| **Desktop (≥1024px)** | Three columns. **Left:** sidebar navigation (logo, Learn, Letters, Practice, Leaderboards, Quests, Shop, Profile, More). **Center:** the learning path. **Right:** a stats row (course badge, streak, coins, hearts) plus league, daily-quests and "create a profile" cards |
| **Tablet (768–1023px)** | Collapsed icon sidebar, center path, and the right-column cards stacked under the stats row |
| **Mobile web (<768px)** | Stats bar at the top, tab bar at the bottom (Learn, Letters, Practice, Leaderboard, Profile, More) |

### 2.2 Lesson screen

- The lesson player is full-screen with no app chrome, centered, max width about 640px.
- **Top:** a close (X) button, the progress bar, and the hearts count.
- **Middle:** the prompt, with a character and speech bubble where relevant, and the answer area.
- **Footer bar:** **SKIP** and **CHECK**. CHECK stays grey until an answer is ready.
- After checking, the footer turns into the **feedback bar**:
  - correct: turquoise tint, "Nice!" and **CONTINUE**;
  - wrong: pomegranate tint, "Correct solution:", a report flag and **CONTINUE**.

### 2.3 Screen inventory

- **Welcome** → **Onboarding.** Onboarding asks:
  - why the learner is studying (heritage/family, partner, travel, culture/poetry, work);
  - their level ("new", "some words", "*I speak but can't read*", "basics");
  - a daily goal;
  - a neutral 13+ age confirmation.
- **Learn path** and each unit's **Guidebook**.
- **Lesson player:** challenge screens, feedback bar, out-of-hearts modal, and a "Wait, don't go!" quit dialog.
- **Lesson-complete sequence:** XP / accuracy / time cards → streak extended → daily goal → league change (P2) → quest progress (P2).
- **Letters tab:** an alphabet grid with a mastery bar under each letter, tap to hear it, and a "Learn the letters" CTA.
- Practice, Leaderboard (P2), Quests (P2), Shop (P2), Profile, Settings, Paywall (P2).
- **Course badge:** a neutral language badge (a turquoise tile with **ز**), never a national flag (§9).

## 3. The learning path

- **Units** open with a colored banner showing section, unit number, title and a **GUIDEBOOK** button. Banner colors cycle through the palette.
- **Nodes** are 70px 3D circles laid out on a repeating horizontal offset: `0, −45, −70, −45, 0, +45, +70, +45` px.
  - Node types and icons: star (lesson), book (story, P2), dumbbell (practice), chest (reward), trophy (unit review).
  - The current node has a **progress ring** and a bouncing **START** bubble.
  - Completed nodes are filled with the unit color; locked nodes are grey with no lip color.
  - Legendary levels turn eggplant (Bādemjān).
- **"Jump here?"** A locked unit's first node offers a test-out.
- **Characters** stand idle beside the widest offsets (±70px) as Rive loops, which pause when scrolled off-screen.
- The layout is generated from the course manifest (`packages/ui/PathLayout`); no path is hand-positioned.

## 4. Design tokens

The source of truth is **`packages/ui/tokens.json`** (W3C design-token format). It builds into CSS
variables and the Tailwind `@theme`, can sync with Figma Variables, and can later export a React
Native theme.

### 4.1 Brand palette

The names come from Persian materials and foods. Contrast ratios are for the stated label color on
the fill.

| Token | Name | Fill (`-500`) | Lip (`-600`) | Label on fill | Used for |
|---|---|---|---|---|---|
| `firouzeh` | **Firouzeh** (turquoise) | `#0E9F99` | `#0A7A75` | white, **large text only** (3.3:1) | primary buttons, active nodes, correct feedback |
| `zaferan` | **Za'farān** (saffron) | `#FFB020` | `#D98A00` | ink (7.3:1) | XP, streak flame, chests |
| `lajvard` | **Lājvard** (lapis) | `#2D5BD7` | `#1F3F99` | white (5.8:1) | coins, links, selected state, Zaboon Plus |
| `anar` | **Anār** (pomegranate) | `#E5484D` | `#B8323A` | white, **large text only** (3.9:1) | hearts, wrong answers, destructive actions |
| `bademjan` | **Bādemjān** (eggplant) | `#7B4BC4` | `#5A3494` | white (5.8:1) | legendary levels, stories |
| `pesteh` | **Pesteh** (pistachio) | `#8CC63F` | `#6E9F2C` | ink (6.5:1) | quests, achievements |

**Large text** (WCAG): ≥18.66px bold, or ≥24px regular. Button labels are 19px/800 (§5), so white
labels on Firouzeh and Anār pass AA. **Body-size text never sits on those two fills.**

### 4.2 Neutrals and semantic tokens

| Token | Light | Dark (proposal) | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#10181B` | page background |
| `surface` | `#F7F7F7` | `#18242A` | secondary surfaces |
| `line` | `#E5E5E5` | `#2A3B42` | borders, card lips, locked nodes |
| `ink` | `#2F2F2F` | `#F0F4F5` | primary text |
| `stone` | `#737373` | `#A3B3B9` | secondary text |
| `mist` | `#B8B8B8` | `#5F737A` | disabled text and icons |
| `correct-bg` / `correct-fg` | `#D8F4F2` / `#08706B` (5.1:1) | `#0F3A38` / `#7FE0D8` (8.1:1) | correct feedback bar |
| `wrong-bg` / `wrong-fg` | `#FFE4E5` / `#B8323A` (4.9:1) | `#45191C` / `#FF9A9E` (7.4:1) | wrong feedback bar |
| `selected-bg` / `selected-border` | `#E8EEFC` / `lajvard-500` | `#1B2A4F` / `lajvard-500` | selected choice cards and tiles |

A unit test in `packages/ui` checks every text/background pair against WCAG AA, taking into
account whether the text is large. That test, not this table, is the gate: if a token changes,
the test must still pass.

### 4.3 The 3D recipe

These values match Duolingo's observed geometry; the colors are ours.

```css
/* Filled button: primary, secondary, danger… */
.btn-3d {
  background: var(--fill);            /* e.g. var(--firouzeh-500) */
  color: var(--label);                /* white or ink, per §4.1 */
  border-radius: 12px;
  box-shadow: 0 4px 0 var(--lip);     /* the solid "lip", no blur */
  font: 800 19px/1 var(--font-latin);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}
.btn-3d:active { transform: translateY(4px); box-shadow: 0 0 0 var(--lip); }
.btn-3d:disabled { --fill: var(--line); --lip: var(--mist); --label: var(--stone); }

/* Outline card and tile: choices, word tiles, match pairs */
.card-3d {
  background: var(--bg);
  border: 2px solid var(--line);
  border-bottom-width: 4px;
  border-radius: 16px;                /* word tiles use 12px */
}
.card-3d:active { transform: translateY(2px); border-bottom-width: 2px; }
.card-3d[aria-pressed="true"] { border-color: var(--selected-border); background: var(--selected-bg); }
```

## 5. Typography

| Role | Font | Settings |
|---|---|---|
| Latin UI and body | **Nunito** (OFL) | body 17px/600; emphasis 700; headings and buttons 800 |
| Button labels | Nunito | 19px/800, uppercase, `letter-spacing: 0.04em` (WCAG large text) |
| Persian content | **Vazirmatn** (OFL, variable) | about 1.15× the surrounding Latin size; line-height ≥1.8 so vowel marks aren't clipped; weights 500 and 700 |
| Persian display (logo, headlines) | **Lalezar** or **Estedad** (both OFL) | display sizes only |

- **Loading:** fonts are self-hosted through `next/font` with Latin and Arabic subsets and `font-display: swap`.
- **Coverage:** the Persian subset must include ZWNJ/ZWJ, the vowel marks (U+064B–U+0652, U+0670), the digits ۰–۹ and « » ؟ ، ؛.
- **Not used:** Duolingo's Feather Bold is proprietary and its DIN Next Rounded is commercial.

## 6. Component kit

The kit lives in `packages/ui`. Every interactive component has hover, focus-visible, active and
disabled states, plus a reduced-motion variant.

| Component | Notes |
|---|---|
| `Button3D` | `primary`, `secondary`, `danger`, `ghost`, `locked` variants (§4.3) |
| `ChoiceCard` | Multiple-choice card with a 1–9 keyboard hint in the corner |
| `WordTile`, `TileBank` | **Whole-word** tiles (a half-space compound like می‌خوام is one tile) with `white-space: nowrap`. Tiles fly between the bank and the answer line using shared-layout animation and leave a grey placeholder in the bank. The answer line's direction comes from the challenge's answer language |
| `ProgressBar` | Rounded track with a highlight stripe; glows with an "N in a row" badge on combos |
| `FeedbackBar` | Correct/wrong footer; the solution is rendered through `FaText`, and diffs highlight **whole words** |
| `PathNode`, `UnitBanner`, `PathLayout` | See §3 |
| `StatPill` | Streak, coins and hearts, with popovers (streak calendar, heart refill) |
| `SpeechBubble`, `Character` | Rive character plus bubble; the bubble text can be Persian or English |
| `FaText` | Renders Persian with `lang="fa" dir="rtl"`, per-token transliteration, tap-for-hint and optional vowel marks. It never styles part of a word, because that breaks letter joining, especially in WebKit (see [Learning engine §1](LEARNING-ENGINE.md#1-persian-language-layer)) |
| `PersianKeyboard` (P2) | Standard (ISIRI 9147) and phonetic layouts, long-press variants, and a half-space key |
| `Modal`, `BottomSheet`, `Toast`, `ConfettiBurst` | Standard overlays and celebration effects |

## 7. Characters

### 7.1 Mascot: Hodhod the hoopoe (placeholder, to be confirmed)

- **Why a hoopoe:** it's the guide in Attar's *Conference of the Birds*, which leads the birds on a journey. That fits a learning journey, and the course's final trophy could be meeting the **Simorgh**.
- **Silhouette:** distinctive and nothing like an owl.
  - A **fan crest** of rounded saffron feathers with dark tips.
  - A warm cinnamon body.
  - Black-and-white banded wings.
  - A long, gently curved beak with a rounded tip.
- **The crest doubles as an emotion display:** flared when proud, drooped when sad, twitching while thinking.
- **Alternatives considered:** "Pashmak", a Persian cat; "Yuz", an Asiatic cheetah.

### 7.2 Cast (placeholders)

Each character has a dedicated voice actor and a personality guide in `content/fa-en/characters/`,
so writers keep each voice consistent.

| Character | Who | Main units |
|---|---|---|
| **Maman Bozorg** | A grandmother who insists you eat more | Ta'ārof, food, family |
| **Shirin** | A Tehran university student with dry humor | Everyday conversation |
| **Dariush** | A chatty taxi driver | Directions, city, numbers |
| **Kian** | An LA-born heritage learner, learning alongside you | Heritage-track moments |
| **Leila** | A chef | Food, the bazaar |
| **Babak** | A santur player | Culture, music, poetry |

**Style:** flat and geometric. Characters are built from rounded rectangles, circles and rounded
triangles, with no sharp points. They use our own proportions and our palette, and no gradients.

### 7.3 Rive specification

- **Files:** one `.riv` file per character, at most ~150 KB each, cached immutably with the content bundles.
- **State machine `Main`** exposes these inputs:
  - `mood` (number): 0 idle, 1 happy, 2 sad, 3 thinking, 4 celebrate;
  - `mouthOpen` (number, 0–1);
  - automatic blinking and idle breathing.
- **Lip-sync (MVP):** `content-cli audio` pre-renders an **amplitude envelope** JSON for every clip, and the player drives `mouthOpen` from it while audio plays. This needs no live audio analysis, so there are no CORS problems and no iOS audio-unlock problems.
- **Lip-sync (later):** viseme tracks, the way Duolingo drives 20+ mouth shapes from audio plus word timings. The tracks come from forced alignment of the audio and ship as JSON next to each clip.
- **Reduced motion:** characters show a static pose. Characters that are off-screen are paused.

### 7.4 Asset generation (GPT Image via OpenRouter)

All character and illustration art is generated with **`openai/gpt-5.4-image-2`**, the latest GPT
Image model, through OpenRouter using the build key (`content-cli art`; see
[Architecture §11](ARCHITECTURE.md#11-ai-integration-openrouter)).

1. **Style bible first.** The art director approves reference sheets for the shape language, the palette and each character's turnaround. They live in `content/fa-en/style-bible/`.
2. **Generate with references.** Every generation passes the relevant style-bible images as image inputs, which keeps characters consistent across poses and scenes.
3. **Outputs:**
   - character concept, turnaround and expression sheets;
   - illustrations for `select_image` challenges;
   - unit banner art;
   - story scenes (P2);
   - marketing art.
4. **Post-processing:** remove the background and crop, then clean the image up into SVG (auto-trace, then a designer pass).
5. **Rigging stays human.** Image models produce flat pictures; a Rive rig needs separate vector parts and state machines, so an animator builds it.
6. **Approval:** nothing reaches `assets/` until the art director approves it.
7. **Model pinning:** the model version is pinned. `content-cli models check` flags a newer GPT Image, and upgrading is a deliberate decision, because switching models mid-course shifts the art style.

Every asset gets a provenance sidecar:

```yaml
# content/fa-en/assets/characters/hodhod/expressions.png.yaml
asset: characters/hodhod/expressions.png
model: openai/gpt-5.4-image-2
prompt: art/character-expressions@2
references:
  - style-bible/shape-language.png
  - style-bible/hodhod-turnaround.png
generatedAt: 2026-09-25
approvedBy: art-director
status: approved
```

Prompt templates describe **our** shape language and palette. For example:

> Flat character illustration built only from rounded rectangles, circles and rounded triangles; no
> sharp points, no outlines, no gradients; solid fills from this palette only: #0E9F99 #FFB020
> #2D5BD7 #E5484D #7B4BC4 #8CC63F #2F2F2F #FFFFFF; plain white background. Character: {name}, {description}.
> Sheet: front, three-quarter, side and back views. Match the proportions of the attached references.

## 8. Sound, motion and accessibility

- **Sound:** original sound effects with a Persian flavor, loaded as one Howler audio sprite. Toggleable in Settings.

  | Moment | Sound idea |
  |---|---|
  | Correct answer | a bright santur pluck |
  | Wrong answer | a soft, low tar note (never harsh) |
  | Lesson complete | a short daf-and-santur flourish |
  | Streak extended | a rising santur arpeggio |
  | Tap / tile move | a subtle wooden click |

- **Motion:**
  - Taps take 80ms.
  - Tiles fly with a shared-layout animation of about 250ms.
  - The feedback bar slides up with a spring of about 300ms.
  - XP and streak counters count up.
  - Confetti plays only on celebrations.
  - Everything respects `prefers-reduced-motion` and the in-app animation toggle.
- **Accessibility:**
  - Keyboard: 1–9 picks an option, Enter checks or continues, Esc opens the quit dialog. Every action is reachable by keyboard.
  - Screen readers: feedback is announced through an ARIA live region, and Persian spans carry `lang="fa"` so screen readers switch voice.
  - Feedback never relies on color alone; it always has an icon plus text.
  - After an audio challenge the transcript is shown.

## 9. Boundaries

We copy Duolingo's **interaction patterns and layout grammar**, which are generic, and nothing
that identifies Duolingo.

- **Never reuse** Duolingo's owl or other characters, character names ("Duo", "Lily", …), logo, fonts (Feather Bold, DIN Next Rounded), sounds, illustrations or UI copy.
- **AI prompts** never mention Duolingo or its characters.
- **No national flags as the course badge.** Both the current Iranian flag and the Lion-and-Sun flag are divisive in the diaspora; use the neutral **ز** badge.
- **Naming:** market the course as "Persian (Farsi)".
