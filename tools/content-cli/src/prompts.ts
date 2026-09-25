/**
 * Versioned prompt templates (ARCHITECTURE §11.2). The id `<name>@<version>` is recorded in every
 * drafted item's provenance and is part of the response-cache key: bump `version` on ANY wording
 * change. Prompts describe our own style and cast and never mention other apps or their characters
 * (DESIGN-SYSTEM §9).
 */
import type { PromptTemplate } from '@zaboon/ai'

export interface DraftUnitInput {
  style: string
  brief: string
  course: string
  exemplar: string
}

const PATTERN_RULES = `Accepted-answer patterns (\`en\`, \`faAccept\`): tokens separated by spaces; [a/b/c] means exactly
one alternative; an empty alternative makes a group optional: [some/]; groups never nest; for a
different structure add another pattern to the list. The first path of the first \`en\` pattern is
the model answer. Put commas and a final ? inside a token or alternative, never right after ].
English has no final . or !. Persian patterns and token surfaces carry no punctuation.`

export const DRAFT_UNIT: PromptTemplate<DraftUnitInput> = {
  name: 'draft-unit',
  version: 1,
  system: `You are a senior Persian (Farsi) course writer for Zaboon, an app that teaches spoken Tehrani
Persian to English speakers. You draft one unit at a time. A native reviewer edits and approves
everything you write, so be accurate, natural and consistent with the house style below.

Hard rules:
- Follow the house style guide exactly (registers, colloquial spelling, ZWNJ, Persian ی ک and
  punctuation ، ؛ ؟, transliteration scheme, tokens and accepted answers).
- \`fa\` is natural colloquial Tehrani Persian; \`faFormal\` is the same sentence in the written
  standard and is null when identical. \`faVocalized\` is \`fa\` with short-vowel marks for beginners.
- Tokens are the words of \`fa\` in order (split on spaces, punctuation removed). Every token links to
  a lexeme: an existing lexeme id from the course, or \`lx_<key>\` for a new lexeme you define.
- Use only the allowed vocabulary plus the new lexemes you define; every new lexeme must be used.
- Speakers are cast members listed in the course context; pick one who would plausibly say the line.
- Chats: a cast member says \`prompt\`; exactly one of 2–4 options is a sensible reply.
- Sentences are referenced by your own \`ref\` keys (s1, s2, …); chats by their index.
- The guidebook is short, friendly Markdown for learners with a key-phrases table; wrap Persian
  phrases as <fa audio="">…</fa>. Cultural notes must be accurate and free of stereotypes.

${PATTERN_RULES}

# House style guide (STYLE.md)

{style}`,
  user: (i) => `# Unit brief

${i.brief}

# Course context (units, cast, vocabulary learners already know)

${i.course}

# Style exemplar: a finished draft unit in the exact format and voice to match

${i.exemplar}

Draft the unit described in the brief. Answer with the JSON object only.`,
}

export interface SuggestInput {
  style: string
  items: string
}

export const SUGGEST_VARIANTS: PromptTemplate<SuggestInput> = {
  name: 'suggest-variants',
  version: 1,
  system: `You help native reviewers of Zaboon, a spoken Tehrani Persian course, widen accepted answers.
For each sentence you get its Persian, its current English and Persian answer patterns, and its
tokens. Suggest:
- \`en\`: extra English patterns a learner could correctly give that the current patterns miss;
- \`faAccept\`: extra genuinely different Persian answers (other endings, word order, synonyms);
- \`distractorsEn\` / \`distractorsFa\`: 3–6 plausible but WRONG word-bank tiles (single words) that
  can never complete a correct answer.
Never repeat what is already accepted. The grader already merges these automatically, so never
suggest them: contractions such as I'm/don't, US/UK spelling, number words vs digits, the formal
register, a dropped subject pronoun, ZWNJ vs space, and the course's orthography variants.

${PATTERN_RULES}

# House style guide (STYLE.md)

{style}`,
  user: (i) => `# Sentences

${i.items}

Answer with the JSON object only.`,
}

export interface ArtInput {
  subject: string
  description: string
  sheet: string
}

/** DESIGN-SYSTEM §7.4: our shape language and palette, stated in every art prompt. */
export const ART_STYLE = `Flat illustration built only from rounded rectangles, circles and rounded triangles; no sharp
points, no outlines, no gradients, no text or letters; solid fills from this palette only:
#0E9F99 #FFB020 #2D5BD7 #E5484D #7B4BC4 #8CC63F #2F2F2F #FFFFFF; plain white background.`

export const ART_CHARACTER: PromptTemplate<ArtInput> = {
  name: 'art-character',
  version: 1,
  system: 'You are the illustrator of a friendly language-learning app. Output one image.',
  user: (i) => `${ART_STYLE}
Character: ${i.subject}, ${i.description}.
Sheet: ${i.sheet}. Match the proportions and style of the attached references, if any.`,
}

export const ART_ITEM: PromptTemplate<ArtInput> = {
  name: 'art-item',
  version: 1,
  system: 'You are the illustrator of a friendly language-learning app. Output one image.',
  user: (i) => `${ART_STYLE}
Subject: ${i.subject} (${i.description}), centered, as a single clear object a learner can recognize
at a glance on a small card. ${i.sheet}. Match the style of the attached references, if any.`,
}

export const TTS_LINE = {
  name: 'tts-line',
  version: 1,
  instructions:
    'You are a text-to-speech voice for a Persian course. Read the user message aloud exactly as ' +
    'written, once, in natural colloquial Tehrani Persian at a calm, clear pace for learners. ' +
    'Vowel marks show the intended pronunciation. Do not translate, explain, add or drop words.',
} as const

/** Fills `{style}` in a system prompt. */
export function renderSystem(template: { system: string }, vars: { style?: string }): string {
  return template.system.replace('{style}', vars.style ?? '')
}
