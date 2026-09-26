/**
 * @zaboon/content-schema: the content contract (docs/LEARNING-ENGINE.md §2–§4).
 *
 * Two layers:
 *   1. Authoring schemas: what humans and `content-cli draft` write as YAML under content/<course>/.
 *   2. Compiled bundle schemas: what `content-cli build` emits and the app/session-engine consume.
 *
 * This package is the lowest layer of the monorepo: it depends only on zod. Orchestrator-owned:
 * changes require a Wave-0-style contract update (see CLAUDE.md).
 */
import { z } from 'zod'

export const CONTENT_SCHEMA_VERSION = 1 as const

// ---------------------------------------------------------------------------------------------
// IDs (stable forever; allocated by content-cli; never reused)
// ---------------------------------------------------------------------------------------------
export const UnitId = z.string().regex(/^u\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'unit id like u04-food')
export const LevelId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'level id like u04-l1')
export const LexemeId = z.string().regex(/^lx_[a-z0-9_]+$/, 'lexeme id like lx_ab')
export const SentenceId = z.string().regex(/^s_[a-z0-9_]+$/, 'sentence id like s_u04_0007')
export const LetterId = z.string().regex(/^l_[a-z0-9_]+$/, 'letter id like l_be')
export const ChatId = z.string().regex(/^c_[a-z0-9_]+$/, 'chat id like c_u01_001')
export const CharacterId = z.string().regex(/^[a-z][a-z0-9-]*$/, 'character id like maman-bozorg')
export const SectionId = z.string().regex(/^s\d{1,2}$/, 'section id like s1')
export const StoryId = z.string().regex(/^st_[a-z0-9_]+$/, 'story id like st_u01_tea')
export const CourseId = z.string().regex(/^[a-z][a-z0-9-]*$/)

/** Any content item reference used in sessions, reports and stats: "<kind>:<id>". */
export const ItemRef = z.string().regex(/^(lexeme|sentence|letter|chat):[a-z0-9_-]+$/)
export type ItemRef = z.infer<typeof ItemRef>

// ---------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------
export const Status = z.enum(['draft', 'approved'])
export type Status = z.infer<typeof Status>

/** Who produced an item. Human-authored items set `author`; AI drafts set `model` + `prompt`. */
export const Provenance = z
  .object({
    author: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    generatedAt: z.string().optional(),
    reviewedBy: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
  })
  .refine((p) => Boolean(p.author || p.model), { message: 'provenance needs author or model' })
export type Provenance = z.infer<typeof Provenance>

/** Content-relative media path, e.g. "audio/lx_ab.mp3" (resolved under content/<course>/assets/). */
export const MediaRef = z
  .string()
  .regex(
    /^[a-z0-9_./-]+\.(mp3|m4a|webp|png|svg|json|riv)$/,
    'lowercase media path with a known extension',
  )
export type MediaRef = z.infer<typeof MediaRef>

export const Register = z.enum(['colloquial', 'formal'])
export type Register = z.infer<typeof Register>

export const PaletteColor = z.enum(['firouzeh', 'zaferan', 'lajvard', 'anar', 'bademjan', 'pesteh'])
export type PaletteColor = z.infer<typeof PaletteColor>

export const PartOfSpeech = z.enum([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'interjection',
  'number',
  'particle',
  'phrase',
])
export type PartOfSpeech = z.infer<typeof PartOfSpeech>

/**
 * Accepted-answer pattern (LEARNING-ENGINE §3.1): tokens separated by spaces; `[a/b]` alternatives;
 * `[a/]` optional; no nesting; escape with backslash. One string or a list of alternative structures.
 */
export const Pattern = z.string().min(1)
export const Patterns = z.union([Pattern, z.array(Pattern).min(1)])
export type Patterns = z.infer<typeof Patterns>

export const Token = z.object({
  surface: z.string().min(1),
  lexeme: LexemeId.optional(),
  translit: z.string().min(1),
  gloss: z.string().optional(),
})
export type Token = z.infer<typeof Token>

// ---------------------------------------------------------------------------------------------
// Challenge types (shared by lesson specs and the runtime Challenge union in @zaboon/contracts)
// ---------------------------------------------------------------------------------------------
export const MVP_CHALLENGE_TYPES = [
  'select_image',
  'select_translation',
  'translate_bank',
  'translate_type',
  'match_pairs',
  'listen_tap',
  'cloze_choice',
  'complete_chat',
  'letter_intro',
  'letter_sound',
  'letter_forms',
  'read_word',
  'build_word',
] as const
export const LATER_CHALLENGE_TYPES = [
  'listen_type',
  'cloze_type',
  'letter_trace',
  'speak',
  'story',
] as const
export const ChallengeType = z.enum([...MVP_CHALLENGE_TYPES, ...LATER_CHALLENGE_TYPES])
export type ChallengeType = z.infer<typeof ChallengeType>

export const Direction = z.enum(['fa_en', 'en_fa'])
export type Direction = z.infer<typeof Direction>

// ---------------------------------------------------------------------------------------------
// Authoring entities
// ---------------------------------------------------------------------------------------------
const authored = { status: Status, provenance: Provenance }

export const Lexeme = z.object({
  id: LexemeId,
  fa: z.string().min(1),
  faFormal: z.string().min(1).optional(),
  faVocalized: z.string().min(1).optional(),
  translit: z.string().min(1),
  translitFormal: z.string().min(1).optional(),
  pos: PartOfSpeech,
  glosses: z.array(z.string().min(1)).min(1),
  audio: MediaRef.optional(),
  image: MediaRef.optional(),
  forms: z.record(z.string(), z.string()).optional(),
  introducedIn: UnitId,
  tags: z.array(z.string()).optional(),
  ...authored,
})
export type Lexeme = z.infer<typeof Lexeme>

export const SentenceAudio = z.object({
  normal: MediaRef.optional(),
  slow: MediaRef.optional(),
  envelope: MediaRef.optional(),
  formal: MediaRef.optional(),
  speaker: CharacterId.optional(),
  signedOffBy: z.string().nullable().optional(),
})

export const Sentence = z.object({
  id: SentenceId,
  fa: z.string().min(1),
  faFormal: z.string().min(1).optional(),
  faVocalized: z.string().min(1).optional(),
  translit: z.string().min(1),
  translitFormal: z.string().min(1).optional(),
  tokens: z.array(Token).min(1),
  en: Patterns,
  faAccept: Patterns.optional(),
  pronounDrop: z.boolean().optional(),
  audio: SentenceAudio.optional(),
  unit: UnitId,
  tags: z.array(z.string()).optional(),
  ...authored,
})
export type Sentence = z.infer<typeof Sentence>

export const Letter = z.object({
  id: LetterId,
  letter: z.string().min(1).max(2),
  name: z.string().min(1),
  translit: z.string(),
  ipa: z.string(),
  connects: z.boolean(),
  family: z.string().optional(),
  order: z.number().int().nonnegative(),
  examples: z.array(LexemeId).default([]),
  audio: MediaRef.optional(),
  ...authored,
})
export type Letter = z.infer<typeof Letter>

export const LetterLesson = z.object({
  id: LevelId,
  title: z.string().min(1),
  letters: z.array(LetterId).min(1),
})
export type LetterLesson = z.infer<typeof LetterLesson>

export const LettersTrack = z.object({
  letters: z.array(Letter).min(1),
  lessons: z.array(LetterLesson).min(1),
})
export type LettersTrack = z.infer<typeof LettersTrack>

/** complete_chat items: a character says `prompt`; the learner picks the best reply. */
export const Chat = z.object({
  id: ChatId,
  speaker: CharacterId,
  prompt: SentenceId,
  options: z.array(SentenceId).min(2).max(4),
  answer: z.number().int().nonnegative(),
  ...authored,
})
export type Chat = z.infer<typeof Chat>

export const Character = z.object({
  id: CharacterId,
  name: z.string().min(1),
  nameFa: z.string().optional(),
  role: z.string().min(1),
  bio: z.string().min(1),
  voice: z.string().optional(),
  color: PaletteColor.optional(),
  image: MediaRef.optional(),
  rive: MediaRef.optional(),
  ...authored,
})
export type Character = z.infer<typeof Character>

/**
 * One line of a story (P2). `speaker` is one of the story's `characters`, or null for the
 * narrator; `tokens` spell `fa` word by word, like a sentence's; `en` is the line's translation.
 */
export const StoryLine = z.object({
  speaker: CharacterId.nullable(),
  fa: z.string().min(1),
  faVocalized: z.string().min(1).optional(),
  translit: z.string().min(1),
  en: z.string().min(1),
  tokens: z.array(Token).min(1),
  audio: MediaRef.optional(),
})
export type StoryLine = z.infer<typeof StoryLine>

/**
 * A comprehension check, asked once the first `after` lines have been read (1-based: `after: 3`
 * follows line 3). `choices` are in the prompt's language; `answer` indexes them.
 */
export const StoryQuestion = z.object({
  after: z.number().int().min(1),
  prompt: z.object({ lang: z.enum(['fa', 'en']), text: z.string().min(1) }),
  choices: z.array(z.string().min(1)).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export type StoryQuestion = z.infer<typeof StoryQuestion>

/**
 * An illustrated story (P2, content/<course>/stories/*.yaml), played by a `kind: story` level of
 * its unit. Its questions split the lines into beats: each beat ends with a question, and the
 * lines after the last question are the closing beat. content-cli's validator checks what the
 * schema cannot: speakers are in `characters`, tokens spell `fa`, questions are in range and in
 * order, and a level has kind story exactly when it names a story of its own unit.
 */
export const Story = z.object({
  id: StoryId,
  unit: UnitId,
  title: z.string().min(1),
  titleFa: z.string().min(1).optional(),
  image: MediaRef.optional(),
  characters: z.array(CharacterId).min(1),
  lines: z.array(StoryLine).min(2).max(40),
  questions: z.array(StoryQuestion).min(1).max(8),
  ...authored,
})
export type Story = z.infer<typeof Story>

/** A hand-pinned challenge in a lesson spec (fixtures pin every type; real lessons pin few). */
export const PinnedChallenge = z.object({
  type: ChallengeType,
  items: z.array(z.string().min(1)).min(1),
  direction: Direction.optional(),
  distractors: z.array(z.string().min(1)).optional(),
})
export type PinnedChallenge = z.infer<typeof PinnedChallenge>

export const MixProfile = z.enum(['intro', 'standard', 'legendary', 'letters', 'practice'])
export type MixProfile = z.infer<typeof MixProfile>

export const LessonSpec = z.object({
  focus: z.object({
    lexemes: z.array(LexemeId).default([]),
    sentences: z.array(SentenceId).default([]),
    letters: z.array(LetterId).default([]),
    chats: z.array(ChatId).default([]),
  }),
  mix: MixProfile.default('standard'),
  length: z.number().int().min(1).max(30).optional(),
  /** Pinned challenges are used verbatim (in order) before generated ones. */
  pinned: z.array(PinnedChallenge).default([]),
  /** When true the session contains exactly the pinned challenges (fixtures). */
  pinnedOnly: z.boolean().default(false),
})
export type LessonSpec = z.infer<typeof LessonSpec>

export const LevelKind = z.enum(['lesson', 'story', 'practice', 'chest', 'unit_review'])
export type LevelKind = z.infer<typeof LevelKind>

export const Level = z.object({
  id: LevelId,
  kind: LevelKind,
  title: z.string().optional(),
  lessons: z.number().int().min(1).max(10).default(1),
  spec: LessonSpec.optional(),
  /**
   * P2: the story a `kind: story` level plays. No refine here (zod 4 cannot extend a refined
   * object); content-cli's validator requires it exactly on story levels.
   */
  story: StoryId.optional(),
})
export type Level = z.infer<typeof Level>

export const Unit = z.object({
  id: UnitId,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  register: Register.default('colloquial'),
  color: PaletteColor,
  guidebook: z.string().optional(),
  characters: z.array(CharacterId).default([]),
  levels: z.array(Level).min(1),
  ...authored,
})
export type Unit = z.infer<typeof Unit>

export const Section = z.object({
  id: SectionId,
  title: z.string().min(1),
  cefr: z.enum(['A1', 'A2', 'B1', 'B2']),
  units: z.array(UnitId).min(1),
})
export type Section = z.infer<typeof Section>

export const Course = z.object({
  id: CourseId,
  title: z.string().min(1),
  fromLang: z.literal('en'),
  learningLang: z.literal('fa'),
  sections: z.array(Section).min(1),
})
export type Course = z.infer<typeof Course>

/** content/<course>/orthography-variants.yaml: sets of interchangeable spellings. */
export const OrthographyVariants = z.array(z.array(z.string().min(1)).min(2))
export type OrthographyVariants = z.infer<typeof OrthographyVariants>

// ---------------------------------------------------------------------------------------------
// Serialized answer graph (compiled by @zaboon/grader at build time; shipped in bundles)
// ---------------------------------------------------------------------------------------------
/**
 * A token DAG: nodes are integers, `start` is the entry node, `accept` lists accepting nodes.
 * Each edge carries a display token `t` (as authored); `t === ''` is an epsilon edge.
 * Matching normalizes both sides at runtime; the graph keeps display forms for feedback.
 */
export const AnswerGraph = z.object({
  v: z.literal(1),
  start: z.number().int().nonnegative(),
  accept: z.array(z.number().int().nonnegative()).min(1),
  edges: z.array(
    z.object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
      t: z.string(),
    }),
  ),
  /** Register of each accepting path family, when known ('colloquial' | 'formal'). */
  registers: z.record(z.string(), Register).optional(),
})
export type AnswerGraph = z.infer<typeof AnswerGraph>

// ---------------------------------------------------------------------------------------------
// Compiled bundle (content-cli build → /v{N}/...)
// ---------------------------------------------------------------------------------------------
export const PathMigration = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  /** old level id → new level id (null = removed; progress dropped). */
  levels: z.record(z.string(), LevelId.nullable()),
})
export type PathMigration = z.infer<typeof PathMigration>

export const ManifestLevel = z.object({
  id: LevelId,
  kind: LevelKind,
  title: z.string().optional(),
  lessons: z.number().int().min(1),
})

export const ManifestUnit = z.object({
  id: UnitId,
  title: z.string(),
  subtitle: z.string().optional(),
  color: PaletteColor,
  register: Register,
  hasGuidebook: z.boolean(),
  levels: z.array(ManifestLevel).min(1),
})
export type ManifestUnit = z.infer<typeof ManifestUnit>

export const Manifest = z.object({
  schema: z.literal(CONTENT_SCHEMA_VERSION),
  courseId: CourseId,
  title: z.string(),
  version: z.number().int().positive(),
  generatedAt: z.string(),
  /** True when the bundle contains draft items (dev/staging builds only). */
  includesDrafts: z.boolean(),
  sections: z.array(
    z.object({
      id: SectionId,
      title: z.string(),
      cefr: z.string(),
      units: z.array(ManifestUnit).min(1),
    }),
  ),
  /** unit id → bundle path relative to the manifest, e.g. "units/u04-food.json". */
  units: z.record(z.string(), z.string()),
  letters: z.string(),
  characters: z.string(),
  pathMigrations: z.array(PathMigration).default([]),
  /** Base path for media URLs relative to the manifest, e.g. "assets/". */
  assetsBase: z.string(),
})
export type Manifest = z.infer<typeof Manifest>

/** In bundles, media refs are resolved to hashed paths relative to assetsBase. */
export const CompiledSentence = Sentence.extend({
  graphs: z.object({ en: AnswerGraph, fa: AnswerGraph }),
})
export type CompiledSentence = z.infer<typeof CompiledSentence>

export const UnitBundle = z.object({
  schema: z.literal(CONTENT_SCHEMA_VERSION),
  unit: Unit,
  lexemes: z.array(Lexeme),
  sentences: z.array(CompiledSentence),
  chats: z.array(Chat).default([]),
  guidebook: z.string().optional(),
  /**
   * P2: the unit's stories (media refs hashed like sentences'). A bundle built before stories
   * existed parses to `[]`. The trailing `.optional()` keeps the key optional in the TypeScript
   * type only, so bundles assembled in code (content-cli build, the engine's test loader) compile
   * until they fill it; parsing always yields an array. Drop it once both set `stories`.
   */
  stories: z.array(Story).default([]).optional(),
})
export type UnitBundle = z.infer<typeof UnitBundle>

export const LettersBundle = z.object({
  schema: z.literal(CONTENT_SCHEMA_VERSION),
  track: LettersTrack,
  /** Lexemes used as letter examples (so read_word/build_word have data without unit bundles). */
  lexemes: z.array(Lexeme).default([]),
})
export type LettersBundle = z.infer<typeof LettersBundle>

export const CharactersBundle = z.object({
  schema: z.literal(CONTENT_SCHEMA_VERSION),
  characters: z.array(Character),
})
export type CharactersBundle = z.infer<typeof CharactersBundle>

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
export function itemRef(kind: 'lexeme' | 'sentence' | 'letter' | 'chat', id: string): ItemRef {
  return `${kind}:${id}` as ItemRef
}

export function parseItemRef(ref: string): {
  kind: 'lexeme' | 'sentence' | 'letter' | 'chat'
  id: string
} {
  const [kind, id] = ref.split(':') as [string, string]
  if (!['lexeme', 'sentence', 'letter', 'chat'].includes(kind) || !id) {
    throw new Error(`invalid item ref: ${ref}`)
  }
  return { kind: kind as 'lexeme' | 'sentence' | 'letter' | 'chat', id }
}

/** Normalizes `Patterns` (string | string[]) to a list. */
export function patternList(p: Patterns | undefined): string[] {
  if (p === undefined) return []
  return typeof p === 'string' ? [p] : p
}
