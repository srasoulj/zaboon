/**
 * @zaboon/contracts: the API contract between the browser and the route handlers (ADR 0009),
 * plus the shared game-state shapes and config defaults.
 *
 * Orchestrator-owned. Workers consume these types; changing them requires a contract update PR
 * from the orchestrator branch (see CLAUDE.md).
 */
import { z } from 'zod'
import {
  AnswerGraph,
  ChallengeType,
  Direction,
  ItemRef,
  LevelId,
  LexemeId,
  LetterId,
  PaletteColor,
  Token,
  UnitId,
} from '@zaboon/content-schema'

export { ChallengeType, Direction, ItemRef, AnswerGraph, MVP_CHALLENGE_TYPES } from '@zaboon/content-schema'

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------
/** Header honored ONLY in AUTH_MODE=local to time-travel in tests (docs/adr/0009). */
export const TEST_NOW_HEADER = 'x-test-now'
/** Client app version header; the API answers 426 below AppConfig.minAppVersion. */
export const APP_VERSION_HEADER = 'x-zaboon-app-version'
export const DEFAULT_COURSE_ID = 'fa-en'
export const FIXTURE_COURSE_ID = 'fixture'

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
export const IsoDateTime = z.iso.datetime({ offset: true })
export const Uuid = z.string().uuid()

// ---------------------------------------------------------------------------------------------
// Config (app_config table; every number in game-rules comes from here)
// ---------------------------------------------------------------------------------------------
export const SessionKind = z.enum(['lesson', 'practice', 'letters', 'unit_review', 'legendary', 'jump_test'])
export type SessionKind = z.infer<typeof SessionKind>

export const LEAGUE_TIERS = [
  'mes',
  'noqreh',
  'tala',
  'firouzeh',
  'aqiq',
  'lajvard',
  'yaqut',
  'zomorrod',
  'morvarid',
  'almas',
] as const
export const LeagueTier = z.enum(LEAGUE_TIERS)
export type LeagueTier = z.infer<typeof LeagueTier>

export const AppConfig = z.object({
  minAppVersion: z.string(),
  graderWindow: z.number().int().min(1),
  xp: z.object({
    base: z.record(SessionKind, z.number().int().nonnegative()),
    perfectBonus: z.number().int().nonnegative(),
  }),
  hearts: z.object({
    max: z.number().int().positive(),
    regenMinutes: z.number().int().positive(),
    practiceReward: z.number().int().nonnegative(),
  }),
  streak: z.object({
    maxFreezes: z.number().int().nonnegative(),
    signupFreezes: z.number().int().nonnegative(),
    freezeEveryDays: z.number().int().positive(),
  }),
  dailyGoal: z.object({ options: z.array(z.number().int().positive()), default: z.number().int().positive() }),
  tz: z.object({ minChangeIntervalHours: z.number().nonnegative() }),
  session: z.object({
    ttlHours: z.number().positive(),
    lengths: z.record(z.string(), z.number().int().positive()),
    reviewShare: z.number().min(0).max(1),
    newWordsPerLesson: z.number().int().positive(),
  }),
  mixProfiles: z.record(z.string(), z.record(z.string(), z.number().min(0))),
  antiCheat: z.object({
    minMsPerChallenge: z.number().int().nonnegative(),
    maxSessionsPerHour: z.number().int().positive(),
    maxXpPerHour: z.number().int().positive(),
  }),
  srs: z.object({ slowMs: z.number().int().positive(), strengthBars: z.array(z.number().min(0).max(1)) }),
  translit: z.object({ newWordExposures: z.number().int().nonnegative(), letterRetrievability: z.number().min(0).max(1) }),
  leagues: z.object({ cohortSize: z.number().int().positive(), promote: z.number().int(), demote: z.number().int() }),
  quests: z.object({ perDay: z.number().int().positive() }),
  rateLimits: z.record(z.string(), z.object({ perMinute: z.number().int().positive() })),
})
export type AppConfig = z.infer<typeof AppConfig>

export const DEFAULT_APP_CONFIG: AppConfig = {
  minAppVersion: '0.1.0',
  graderWindow: 3,
  xp: {
    base: { lesson: 10, practice: 10, letters: 10, unit_review: 20, legendary: 40, jump_test: 20 },
    perfectBonus: 5,
  },
  hearts: { max: 5, regenMinutes: 240, practiceReward: 1 },
  streak: { maxFreezes: 2, signupFreezes: 1, freezeEveryDays: 7 },
  dailyGoal: { options: [10, 20, 30, 50], default: 20 },
  tz: { minChangeIntervalHours: 24 },
  session: {
    ttlHours: 24,
    lengths: { lesson: 12, practice: 10, letters: 10, unit_review: 15, legendary: 15, jump_test: 15 },
    reviewShare: 0.3,
    newWordsPerLesson: 3,
  },
  mixProfiles: {
    intro: { newWord: 0.25, recognition: 0.3, productionBank: 0.2, listening: 0.15, matching: 0.1 },
    standard: { recognition: 0.25, productionBank: 0.35, listening: 0.25, matching: 0.15 },
    legendary: { productionBank: 0.45, listening: 0.35, recognition: 0.2 },
    letters: { letterIntro: 0.2, letterSound: 0.3, letterForms: 0.2, readWord: 0.15, buildWord: 0.15 },
    practice: { recognition: 0.3, productionBank: 0.3, listening: 0.25, matching: 0.15 },
  },
  antiCheat: { minMsPerChallenge: 800, maxSessionsPerHour: 30, maxXpPerHour: 600 },
  srs: { slowMs: 12000, strengthBars: [0.5, 0.75, 0.9] },
  translit: { newWordExposures: 3, letterRetrievability: 0.8 },
  leagues: { cohortSize: 30, promote: 7, demote: 5 },
  quests: { perDay: 3 },
  rateLimits: {
    default: { perMinute: 120 },
    sessions: { perMinute: 20 },
    events: { perMinute: 240 },
    complete: { perMinute: 30 },
    reports: { perMinute: 10 },
    auth: { perMinute: 10 },
  },
}

/** Feature flags (flag registry). Server-evaluated; exposed via /api/meta. */
export const FLAG_DEFAULTS = {
  leagues: false,
  quests: false,
  shop: false,
  practiceHub: false,
  persianKeyboard: false,
  letterTrace: false,
  speak: false,
  stories: false,
  placement: false,
  offline: false,
  energy: false,
  plus: false,
  email: false,
  push: false,
} as const
export type FlagName = keyof typeof FLAG_DEFAULTS
export const Flags = z.record(z.string(), z.boolean())

// ---------------------------------------------------------------------------------------------
// Game state (stored rows + read-only views)
// ---------------------------------------------------------------------------------------------
export const StreakState = z.object({
  current: z.number().int().nonnegative(),
  longest: z.number().int().nonnegative(),
  lastActiveDate: IsoDate.nullable(),
  freezes: z.number().int().nonnegative(),
})
export type StreakState = z.infer<typeof StreakState>

export const StreakStatus = z.enum(['none', 'extended', 'at_risk', 'frozen', 'broken'])
export const StreakView = z.object({
  current: z.number().int().nonnegative(),
  status: StreakStatus,
  freezes: z.number().int().nonnegative(),
  freezesNeeded: z.number().int().nonnegative().optional(),
})
export type StreakView = z.infer<typeof StreakView>

export const LivesPolicyName = z.enum(['hearts', 'unlimited'])
export const LivesState = z.object({
  policy: LivesPolicyName,
  count: z.number().int().nonnegative(),
  updatedAt: IsoDateTime,
})
export type LivesState = z.infer<typeof LivesState>

export const LivesView = z.object({
  policy: LivesPolicyName,
  count: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  nextRegenAt: IsoDateTime.nullable(),
})
export type LivesView = z.infer<typeof LivesView>

/** Mirrors ts-fsrs `Card` (stored per user × lexeme and user × letter). */
export const FsrsCard = z.object({
  due: IsoDateTime,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.number().int().min(0).max(3),
  lastReview: IsoDateTime.nullable(),
})
export type FsrsCard = z.infer<typeof FsrsCard>

export const SrsRating = z.enum(['again', 'hard', 'good', 'easy'])
export type SrsRating = z.infer<typeof SrsRating>

// ---------------------------------------------------------------------------------------------
// Runtime challenges (what the lesson player renders). One discriminated union.
// ---------------------------------------------------------------------------------------------
export const Lang = z.enum(['fa', 'en'])
export type Lang = z.infer<typeof Lang>

export const Media = z.object({ normal: z.string().optional(), slow: z.string().optional(), envelope: z.string().optional() })

export const FaTextDto = z.object({
  fa: z.string(),
  translit: z.string(),
  faFormal: z.string().optional(),
  faVocalized: z.string().optional(),
  tokens: z.array(Token).optional(),
  audio: Media.optional(),
})
export type FaTextDto = z.infer<typeof FaTextDto>

export const PromptText = z.object({
  lang: Lang,
  text: z.string(),
  fa: FaTextDto.optional(),
})

/** Compact, rebuildable reference stored in sessions.challenge_refs. */
export const ChallengeRef = z.object({
  type: ChallengeType,
  items: z.array(z.string()).min(1),
  direction: Direction.optional(),
  distractors: z.array(z.string()).optional(),
  variant: z.number().int().nonnegative().optional(),
})
export type ChallengeRef = z.infer<typeof ChallengeRef>

const base = {
  index: z.number().int().nonnegative(),
  ref: ChallengeRef,
  isNew: z.boolean().default(false),
}

export const SelectImageChallenge = z.object({
  ...base,
  type: z.literal('select_image'),
  prompt: FaTextDto,
  choices: z.array(z.object({ lexeme: LexemeId, image: z.string(), label: z.string() })).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const SelectTranslationChallenge = z.object({
  ...base,
  type: z.literal('select_translation'),
  direction: Direction,
  prompt: PromptText,
  choices: z.array(PromptText).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const TranslateBankChallenge = z.object({
  ...base,
  type: z.literal('translate_bank'),
  direction: Direction,
  prompt: PromptText,
  answerLang: Lang,
  bank: z.array(z.string()).min(2),
  graph: AnswerGraph,
})
export const TranslateTypeChallenge = z.object({
  ...base,
  type: z.literal('translate_type'),
  direction: Direction,
  prompt: PromptText,
  answerLang: Lang,
  graph: AnswerGraph,
})
export const MatchPairsChallenge = z.object({
  ...base,
  type: z.literal('match_pairs'),
  pairs: z.array(z.object({ fa: FaTextDto, en: z.string() })).min(3).max(5),
})
export const ListenTapChallenge = z.object({
  ...base,
  type: z.literal('listen_tap'),
  audio: Media,
  transcript: FaTextDto,
  bank: z.array(z.string()).min(2),
  graph: AnswerGraph,
})
export const ClozeChoiceChallenge = z.object({
  ...base,
  type: z.literal('cloze_choice'),
  before: z.array(Token),
  after: z.array(Token),
  translation: z.string(),
  choices: z.array(z.string()).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const CompleteChatChallenge = z.object({
  ...base,
  type: z.literal('complete_chat'),
  speaker: z.object({ id: z.string(), name: z.string() }),
  prompt: FaTextDto.extend({ en: z.string() }),
  choices: z.array(FaTextDto.extend({ en: z.string() })).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const LetterInfo = z.object({
  id: LetterId,
  letter: z.string(),
  name: z.string(),
  translit: z.string(),
  ipa: z.string(),
  connects: z.boolean(),
  forms: z.object({ isolated: z.string(), initial: z.string(), medial: z.string(), final: z.string() }),
  audio: z.string().optional(),
})
export type LetterInfo = z.infer<typeof LetterInfo>
export const LetterIntroChallenge = z.object({
  ...base,
  type: z.literal('letter_intro'),
  letter: LetterInfo,
  examples: z.array(FaTextDto.extend({ en: z.string() })),
})
export const LetterSoundChallenge = z.object({
  ...base,
  type: z.literal('letter_sound'),
  mode: z.enum(['letter_to_sound', 'sound_to_letter']),
  letter: LetterInfo,
  choices: z.array(z.string()).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const LetterFormsChallenge = z.object({
  ...base,
  type: z.literal('letter_forms'),
  pairs: z.array(z.object({ left: z.string(), right: z.string() })).min(2).max(5),
})
export const ReadWordChallenge = z.object({
  ...base,
  type: z.literal('read_word'),
  word: FaTextDto.extend({ en: z.string() }),
  ask: z.enum(['translit', 'meaning']),
  choices: z.array(z.string()).min(2).max(4),
  answer: z.number().int().nonnegative(),
})
export const BuildWordChallenge = z.object({
  ...base,
  type: z.literal('build_word'),
  target: FaTextDto.extend({ en: z.string() }),
  tiles: z.array(z.string()).min(2),
  answer: z.array(z.string()).min(1),
})
// Later phases (shapes reserved now so the union is stable).
export const ListenTypeChallenge = z.object({
  ...base,
  type: z.literal('listen_type'),
  audio: Media,
  transcript: FaTextDto,
  graph: AnswerGraph,
})
export const ClozeTypeChallenge = z.object({
  ...base,
  type: z.literal('cloze_type'),
  before: z.array(Token),
  after: z.array(Token),
  translation: z.string(),
  graph: AnswerGraph,
})
export const LetterTraceChallenge = z.object({
  ...base,
  type: z.literal('letter_trace'),
  letter: LetterInfo,
  form: z.enum(['isolated', 'initial', 'medial', 'final']),
})
export const SpeakChallenge = z.object({
  ...base,
  type: z.literal('speak'),
  prompt: FaTextDto,
  graph: AnswerGraph,
})
export const StoryChallenge = z.object({
  ...base,
  type: z.literal('story'),
  storyId: z.string(),
})

export const Challenge = z.discriminatedUnion('type', [
  SelectImageChallenge,
  SelectTranslationChallenge,
  TranslateBankChallenge,
  TranslateTypeChallenge,
  MatchPairsChallenge,
  ListenTapChallenge,
  ClozeChoiceChallenge,
  CompleteChatChallenge,
  LetterIntroChallenge,
  LetterSoundChallenge,
  LetterFormsChallenge,
  ReadWordChallenge,
  BuildWordChallenge,
  ListenTypeChallenge,
  ClozeTypeChallenge,
  LetterTraceChallenge,
  SpeakChallenge,
  StoryChallenge,
])
export type Challenge = z.infer<typeof Challenge>
export type ChallengeOf<T extends Challenge['type']> = Extract<Challenge, { type: T }>

// ---------------------------------------------------------------------------------------------
// Answers and verdicts
// ---------------------------------------------------------------------------------------------
export const Verdict = z.enum(['correct', 'typo', 'spelling', 'wrong', 'skipped'])
export type Verdict = z.infer<typeof Verdict>
/** Verdicts that count as a correct answer. */
export const PASSING_VERDICTS: readonly Verdict[] = ['correct', 'typo', 'spelling']

export const ChallengeResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), value: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('text'), value: z.string().max(500) }),
  z.object({ kind: z.literal('tiles'), value: z.array(z.string()).max(40) }),
  z.object({ kind: z.literal('pairs'), value: z.array(z.tuple([z.number().int(), z.number().int()])).max(10) }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('audio'), transcript: z.string().max(500) }),
  z.object({ kind: z.literal('skip') }),
])
export type ChallengeResponse = z.infer<typeof ChallengeResponse>

/** Bounds keep every value inside a Postgres `integer` column (and sane): 400, never 500. */
export const MAX_CHALLENGES = 200
export const MAX_ATTEMPT_SEQ = 10_000
export const MAX_ANSWER_MS = 3_600_000

export const AnswerRecord = z.object({
  index: z.number().int().nonnegative().max(MAX_CHALLENGES - 1),
  attemptSeq: z.number().int().nonnegative().max(MAX_ATTEMPT_SEQ),
  response: ChallengeResponse,
  verdict: Verdict,
  ms: z.number().int().nonnegative().max(MAX_ANSWER_MS),
  hinted: z.boolean().default(false),
})
export type AnswerRecord = z.infer<typeof AnswerRecord>

// ---------------------------------------------------------------------------------------------
// Session result (returned by /complete; stored verbatim in sessions.result)
// ---------------------------------------------------------------------------------------------
export const SessionResult = z.object({
  sessionId: Uuid,
  kind: SessionKind,
  contentVersion: z.number().int().positive(),
  localDate: IsoDate,
  xp: z.object({ base: z.number().int(), bonus: z.number().int(), total: z.number().int() }),
  accuracy: z.number().min(0).max(1),
  perfect: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  streak: StreakView.extend({
    extendedToday: z.boolean(),
    freezeGranted: z.boolean(),
    frozenDates: z.array(IsoDate),
  }),
  lives: LivesView,
  dailyGoal: z.object({ xp: z.number().int(), goal: z.number().int(), met: z.boolean(), justMet: z.boolean() }),
  level: z
    .object({
      levelId: LevelId,
      lessonsDone: z.number().int(),
      lessonsTotal: z.number().int(),
      completed: z.boolean(),
    })
    .nullable(),
  mistakes: z.array(ItemRef),
  graderMismatches: z.number().int().nonnegative(),
})
export type SessionResult = z.infer<typeof SessionResult>

// ---------------------------------------------------------------------------------------------
// Settings, profile and read models
// ---------------------------------------------------------------------------------------------
export const Tristate = z.enum(['auto', 'on', 'off'])
export const LearningReason = z.enum(['heritage', 'partner', 'travel', 'culture', 'work', 'other'])
export const SelfLevel = z.enum(['new', 'some_words', 'speak_not_read', 'basics'])

export const Settings = z.object({
  dailyGoalXp: z.number().int().positive(),
  transliteration: Tristate,
  vowelMarks: Tristate,
  sound: z.boolean(),
  motion: z.enum(['full', 'reduced']),
  keyboardLayout: z.enum(['standard', 'phonetic']),
  reason: LearningReason.nullable(),
  selfLevel: SelfLevel.nullable(),
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = {
  dailyGoalXp: DEFAULT_APP_CONFIG.dailyGoal.default,
  transliteration: 'auto',
  vowelMarks: 'auto',
  sound: true,
  motion: 'full',
  keyboardLayout: 'standard',
  reason: null,
  selfLevel: null,
}

export const UserSummary = z.object({
  id: Uuid,
  isAnonymous: z.boolean(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  ageConfirmed: z.boolean(),
  onboarded: z.boolean(),
})

export const HomeResponse = z.object({
  user: UserSummary,
  course: z.object({ id: z.string(), contentVersion: z.number().int(), currentLevelId: LevelId.nullable() }),
  streak: StreakView,
  lives: LivesView,
  dailyGoal: z.object({ xp: z.number().int(), goal: z.number().int(), met: z.boolean() }),
  xpTotal: z.number().int(),
  settings: Settings,
  flags: Flags,
})
export type HomeResponse = z.infer<typeof HomeResponse>

export const LevelState = z.enum(['locked', 'available', 'current', 'completed', 'legendary'])
export const PathResponse = z.object({
  courseId: z.string(),
  contentVersion: z.number().int(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      cefr: z.string(),
      units: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          subtitle: z.string().optional(),
          color: PaletteColor,
          hasGuidebook: z.boolean(),
          levels: z.array(
            z.object({
              id: LevelId,
              kind: z.string(),
              title: z.string().optional(),
              lessonsTotal: z.number().int(),
              lessonsDone: z.number().int(),
              state: LevelState,
            }),
          ),
        }),
      ),
    }),
  ),
})
export type PathResponse = z.infer<typeof PathResponse>

export const Strength = z.number().int().min(0).max(4)
export const LettersResponse = z.object({
  letters: z.array(
    z.object({
      id: LetterId,
      letter: z.string(),
      name: z.string(),
      translit: z.string(),
      strength: Strength,
      introduced: z.boolean(),
      /** Resolved URL of the letter's sound (tap to hear), when the course has one. */
      audio: z.string().optional(),
    }),
  ),
  lessons: z.array(z.object({ id: LevelId, title: z.string(), letters: z.array(LetterId), state: LevelState })),
})
export type LettersResponse = z.infer<typeof LettersResponse>

export const WordsResponse = z.object({
  words: z.array(
    z.object({
      lexemeId: LexemeId,
      fa: z.string(),
      translit: z.string(),
      gloss: z.string(),
      strength: Strength,
      dueAt: IsoDateTime.nullable(),
      /** Resolved URL of the word's audio, when the course has one. */
      audio: z.string().optional(),
    }),
  ),
})
export type WordsResponse = z.infer<typeof WordsResponse>

/**
 * GET /api/guidebooks/:unitId (?courseId= like /api/path): the unit's Guidebook as markdown. Persian
 * phrases are `<fa audio="…">…</fa>` elements whose audio refs the server resolves to URLs
 * (an unresolvable ref becomes `audio=""`); render it sanitized, never as raw HTML.
 */
export const GuidebookResponse = z.object({
  courseId: z.string(),
  contentVersion: z.number().int(),
  unitId: UnitId,
  title: z.string(),
  markdown: z.string(),
})
export type GuidebookResponse = z.infer<typeof GuidebookResponse>

export const ProfileResponse = z.object({
  id: Uuid,
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatar: z.record(z.string(), z.unknown()).nullable(),
  isAnonymous: z.boolean(),
  createdAt: IsoDateTime,
  stats: z.object({
    xpTotal: z.number().int(),
    streakCurrent: z.number().int(),
    streakLongest: z.number().int(),
    lessonsCompleted: z.number().int(),
  }),
})
export type ProfileResponse = z.infer<typeof ProfileResponse>

export const ProfilePatch = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    username: z
      .string()
      .regex(/^[a-z0-9_]{3,20}$/)
      .optional(),
    avatar: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const SettingsPatch = Settings.partial().strict()

export const OnboardingRequest = z.object({
  reason: LearningReason,
  selfLevel: SelfLevel,
  dailyGoalXp: z.number().int().positive(),
  ageConfirmed: z.literal(true),
  tz: z.string().min(1),
})

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------
export const CreateSessionRequest = z.object({
  courseId: z.string().default(DEFAULT_COURSE_ID),
  kind: SessionKind,
  levelId: LevelId.optional(),
  /** The browser's IANA timezone; accepted at most once per AppConfig.tz.minChangeIntervalHours. */
  tz: z.string().min(1),
})
export const CreateSessionResponse = z.object({
  sessionId: Uuid,
  contentVersion: z.number().int().positive(),
  kind: SessionKind,
  levelId: LevelId.nullable(),
  expiresAt: IsoDateTime,
  challenges: z.array(Challenge).min(1),
  lives: LivesView,
  graderVersion: z.number().int().positive(),
})
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>

export const SessionEventRequest = z.object({
  attemptSeq: z.number().int().nonnegative().max(MAX_ATTEMPT_SEQ),
  index: z.number().int().nonnegative().max(MAX_CHALLENGES - 1),
  kind: z.literal('wrong'),
})
export const SessionEventResponse = z.object({ lives: LivesView, duplicate: z.boolean() })

export const CompleteSessionRequest = z.object({
  answers: z.array(AnswerRecord).min(1).max(MAX_CHALLENGES),
  completedAt: IsoDateTime,
  graderVersion: z.number().int().positive(),
})

// ---------------------------------------------------------------------------------------------
// Account, reports, admin, meta
// ---------------------------------------------------------------------------------------------
export const MergeRequest = z.object({ guestToken: z.string().min(20) })
export const MergeResponse = z.object({ merged: z.boolean(), home: HomeResponse })
export const DeleteAccountResponse = z.object({ deleted: z.literal(true) })
/** GDPR export: a JSON document with every row we hold about the user. */
export const ExportResponse = z.record(z.string(), z.unknown())

export const ReportKind = z.enum(['answer_should_be_accepted', 'audio_problem', 'content_error', 'other'])
export const ReportStatus = z.enum(['new', 'accepted', 'rejected'])
export const CreateReportRequest = z.object({
  itemRef: ItemRef,
  kind: ReportKind,
  sessionId: Uuid.optional(),
  answer: z.string().max(500).optional(),
  text: z.string().max(1000).optional(),
})
export const CreateReportResponse = z.object({ id: Uuid })
export const ReportDto = CreateReportRequest.extend({
  id: Uuid,
  status: ReportStatus,
  createdAt: IsoDateTime,
})
export const AdminReportsResponse = z.object({ reports: z.array(ReportDto) })
export const AdminReportPatch = z.object({ status: ReportStatus })

export const MetaResponse = z.object({
  contentVersion: z.number().int().positive(),
  minAppVersion: z.string(),
  graderVersions: z.array(z.number().int().positive()),
  flags: Flags,
  authMode: z.enum(['supabase', 'local']),
})
export type MetaResponse = z.infer<typeof MetaResponse>

// Dev-only (AUTH_MODE=local) auth emulation.
export const DevTokenResponse = z.object({
  accessToken: z.string(),
  expiresAt: IsoDateTime,
  user: z.object({ id: Uuid, isAnonymous: z.boolean(), email: z.string().nullable() }),
})
export const DevSignInRequest = z.object({ email: z.string().email() })
/** Local stand-in for Supabase's refresh token: re-issues a token for a recently expired one. */
export const DevRefreshRequest = z.object({ accessToken: z.string().min(20) })
export const DevLinkRequest = z.object({ email: z.string().email() })

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------
export const ErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'identity_already_exists',
  'gone',
  'upgrade_required',
  'rate_limited',
  'validation',
  'out_of_lives',
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCode>
export const ErrorEnvelope = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  identity_already_exists: 409,
  gone: 410,
  upgrade_required: 426,
  rate_limited: 429,
  validation: 400,
  out_of_lives: 409,
  internal: 500,
}
