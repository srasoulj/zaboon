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

export {
  ChallengeType,
  Direction,
  ItemRef,
  AnswerGraph,
  MVP_CHALLENGE_TYPES,
} from '@zaboon/content-schema'

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------
/** Header honored ONLY in AUTH_MODE=local to time-travel in tests (docs/adr/0009). */
export const TEST_NOW_HEADER = 'x-test-now'
/**
 * Header honored ONLY in AUTH_MODE=local: a JSON object of feature-flag overrides (known flag
 * names → booleans) merged over the configured flags for that request, so tests can switch a
 * Wave 3 feature on without touching app_config. Production ignores it.
 */
export const TEST_FLAGS_HEADER = 'x-test-flags'
/**
 * Transcript prefix honored ONLY in AUTH_MODE=local (P2 speak): when the decoded `audio` of a
 * POST /api/speech/transcribe starts with these UTF-8 bytes, the server calls no provider and
 * the rest of the bytes is the transcript, so tests can "say" anything (e2e/fixtures
 * `fakeMicrophone`). Production ignores it: the audio goes to the provider like any other.
 */
export const TEST_TRANSCRIPT_PREFIX = 'zaboon-test-transcript:'
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
/**
 * `story` (P2, flags.stories) plays a unit's story level. The server answers 400 `validation` for
 * a kind it cannot generate (yet, or with its flag off).
 */
export const SessionKind = z.enum([
  'lesson',
  'practice',
  'letters',
  'unit_review',
  'legendary',
  'jump_test',
  'story',
])
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

/** Most members a league cohort can hold (the league_cohorts.size CHECK). */
export const MAX_COHORT_SIZE = 30

/** What the shop sells for coins (P2). A heart refill is `POST /api/lives/refill`. */
export const ShopItemId = z.enum(['streak_freeze', 'heart_refill'])
export type ShopItemId = z.infer<typeof ShopItemId>

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
  dailyGoal: z.object({
    options: z.array(z.number().int().positive()),
    default: z.number().int().positive(),
  }),
  tz: z.object({ minChangeIntervalHours: z.number().nonnegative() }),
  session: z.object({
    ttlHours: z.number().positive(),
    lengths: z.record(z.string(), z.number().int().positive()),
    reviewShare: z.number().min(0).max(1),
    newWordsPerLesson: z.number().int().positive(),
  }),
  /**
   * Challenge mix per profile: category → weight. The Wave 3 categories `typing` (typed Persian:
   * translate_type en→fa, listen_type, cloze_type) and `letterTrace` (letter_trace) are dropped
   * by the session engine unless `GenerateInput.features` enables them, so sessions with the
   * features off are exactly the MVP's (packages/session-engine/oracles).
   */
  mixProfiles: z.record(z.string(), z.record(z.string(), z.number().min(0))),
  antiCheat: z.object({
    minMsPerChallenge: z.number().int().nonnegative(),
    maxSessionsPerHour: z.number().int().positive(),
    maxXpPerHour: z.number().int().positive(),
  }),
  srs: z.object({
    slowMs: z.number().int().positive(),
    strengthBars: z.array(z.number().min(0).max(1)),
  }),
  translit: z.object({
    newWordExposures: z.number().int().nonnegative(),
    letterRetrievability: z.number().min(0).max(1),
  }),
  leagues: z.object({
    cohortSize: z.number().int().positive().max(MAX_COHORT_SIZE),
    promote: z.number().int(),
    demote: z.number().int(),
    /** Coins granted at rollover by final rank: index 0 = rank 1 (ranks past the list get none). */
    rewardCoins: z.array(z.number().int().nonnegative()),
  }),
  quests: z.object({
    perDay: z.number().int().positive(),
    /** Coins per completed quest, granted (auto-claimed) in the commit that completes it. */
    rewardCoins: z.number().int().nonnegative(),
  }),
  /** P2 shop: coin prices (every item priced). */
  shop: z.object({ prices: z.record(ShopItemId, z.number().int().positive()) }),
  rateLimits: z.record(z.string(), z.object({ perMinute: z.number().int().positive() })),
  /**
   * P2 speak (flags.speak): transcription caps and the "Can't speak now" pause. Like every key, it
   * has a default, and an app_config row overrides it as a whole top-level key.
   */
  speech: z.object({
    /** Transcriptions per learner per UTC day (POST /api/speech/transcribe; 429 quota_exceeded). */
    dailyQuota: z.number().int().positive(),
    /** Largest decoded upload the server accepts (400 above it). */
    maxAudioBytes: z.number().int().positive(),
    /** Longest recording the server accepts (400 above it). */
    maxDurationMs: z.number().int().positive(),
    /** How long "Can't speak now" leaves speak challenges out of new sessions. */
    pauseMinutes: z.number().int().positive(),
  }),
})
export type AppConfig = z.infer<typeof AppConfig>

export const DEFAULT_APP_CONFIG: AppConfig = {
  minAppVersion: '0.1.0',
  graderWindow: 3,
  xp: {
    base: {
      lesson: 10,
      practice: 10,
      letters: 10,
      unit_review: 20,
      legendary: 40,
      jump_test: 20,
      story: 15,
    },
    perfectBonus: 5,
  },
  hearts: { max: 5, regenMinutes: 240, practiceReward: 1 },
  streak: { maxFreezes: 2, signupFreezes: 1, freezeEveryDays: 7 },
  dailyGoal: { options: [10, 20, 30, 50], default: 20 },
  tz: { minChangeIntervalHours: 24 },
  session: {
    ttlHours: 24,
    lengths: {
      lesson: 12,
      practice: 10,
      letters: 10,
      unit_review: 15,
      legendary: 15,
      jump_test: 15,
      story: 8,
    },
    reviewShare: 0.3,
    newWordsPerLesson: 3,
  },
  // `typing` and `letterTrace` count only while their Wave 3 feature is on (see AppConfig).
  mixProfiles: {
    intro: { newWord: 0.25, recognition: 0.3, productionBank: 0.2, listening: 0.15, matching: 0.1 },
    standard: {
      recognition: 0.25,
      productionBank: 0.35,
      listening: 0.25,
      matching: 0.15,
      typing: 0.15,
    },
    legendary: { productionBank: 0.45, listening: 0.35, recognition: 0.2, typing: 0.2 },
    letters: {
      letterIntro: 0.2,
      letterSound: 0.3,
      letterForms: 0.2,
      readWord: 0.15,
      buildWord: 0.15,
      letterTrace: 0.15,
    },
    practice: {
      recognition: 0.3,
      productionBank: 0.3,
      listening: 0.25,
      matching: 0.15,
      typing: 0.15,
    },
  },
  antiCheat: { minMsPerChallenge: 800, maxSessionsPerHour: 30, maxXpPerHour: 600 },
  srs: { slowMs: 12000, strengthBars: [0.5, 0.75, 0.9] },
  translit: { newWordExposures: 3, letterRetrievability: 0.8 },
  leagues: { cohortSize: MAX_COHORT_SIZE, promote: 7, demote: 5, rewardCoins: [30, 20, 10] },
  quests: { perDay: 3, rewardCoins: 10 },
  shop: { prices: { streak_freeze: 100, heart_refill: 150 } },
  rateLimits: {
    default: { perMinute: 120 },
    sessions: { perMinute: 20 },
    events: { perMinute: 240 },
    complete: { perMinute: 30 },
    reports: { perMinute: 10 },
    auth: { perMinute: 10 },
    shop: { perMinute: 20 },
    cron: { perMinute: 10 },
    speech: { perMinute: 20 },
  },
  speech: { dailyQuota: 60, maxAudioBytes: 512_000, maxDurationMs: 15_000, pauseMinutes: 60 },
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

export const Media = z.object({
  normal: z.string().optional(),
  slow: z.string().optional(),
  envelope: z.string().optional(),
})

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
  choices: z
    .array(z.object({ lexeme: LexemeId, image: z.string(), label: z.string() }))
    .min(2)
    .max(4),
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
  pairs: z
    .array(z.object({ fa: FaTextDto, en: z.string() }))
    .min(3)
    .max(5),
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
  /** `image`: the character's portrait (a media URL) when the course has one; else draw the placeholder. */
  speaker: z.object({ id: z.string(), name: z.string(), image: z.string().optional() }),
  prompt: FaTextDto.extend({ en: z.string() }),
  choices: z
    .array(FaTextDto.extend({ en: z.string() }))
    .min(2)
    .max(4),
  answer: z.number().int().nonnegative(),
})
export const LetterInfo = z.object({
  id: LetterId,
  letter: z.string(),
  name: z.string(),
  translit: z.string(),
  ipa: z.string(),
  connects: z.boolean(),
  forms: z.object({
    isolated: z.string(),
    initial: z.string(),
    medial: z.string(),
    final: z.string(),
  }),
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
  pairs: z
    .array(z.object({ left: z.string(), right: z.string() }))
    .min(2)
    .max(5),
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
/**
 * speak (P2, flags.speak): say `prompt` aloud. The recording goes to POST /api/speech/transcribe;
 * the answer is `{kind: 'audio', transcript, token}` (see ChallengeResponse).
 */
export const SpeakChallenge = z.object({
  ...base,
  type: z.literal('speak'),
  prompt: FaTextDto,
  graph: AnswerGraph,
  /** The prompt's English meaning, shown under it. */
  translation: z.string().optional(),
})

const StorySpeaker = z.object({ id: z.string(), name: z.string(), image: z.string().optional() })
/** One line of a story beat; `speaker` null = the narrator. */
export const StoryLineDto = z.object({
  speaker: StorySpeaker.nullable(),
  text: FaTextDto,
  en: z.string(),
})
export type StoryLineDto = z.infer<typeof StoryLineDto>

/**
 * story (P2, flags.stories): one beat of a story; a story session has one challenge per beat, in
 * order. `beat` is 0-based (< `beats`); `image` is the story's cover (a media URL). A beat with a
 * `question` is answered `{kind: 'choice'}`; the closing beat has none and is answered
 * `{kind: 'none'}`. A wrong answer costs no heart and is retried in place.
 */
export const StoryChallenge = z.object({
  ...base,
  type: z.literal('story'),
  storyId: z.string(),
  title: z.string(),
  image: z.string().optional(),
  beat: z.number().int().nonnegative(),
  beats: z.number().int().positive(),
  lines: z.array(StoryLineDto).min(1).max(30),
  question: z
    .object({
      prompt: PromptText,
      choices: z.array(PromptText).min(2).max(4),
      answer: z.number().int().nonnegative(),
    })
    .optional(),
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
  z.object({
    kind: z.literal('pairs'),
    value: z.array(z.tuple([z.number().int(), z.number().int()])).max(10),
  }),
  z.object({ kind: z.literal('none') }),
  /**
   * speak (P2): `transcript` and `token` are what POST /api/speech/transcribe answered for this
   * challenge. The server re-grades only a transcript whose signed token verifies (bound to the
   * user, session, index and transcript); a missing or mismatched token grades wrong. `declined` =
   * "Can't speak now" (send an empty transcript and no token): it grades correct, costs no heart
   * and starts the speak pause (AppConfig.speech.pauseMinutes).
   */
  z.object({
    kind: z.literal('audio'),
    transcript: z.string().max(500),
    token: z.string().max(400).optional(),
    declined: z.literal(true).optional(),
  }),
  z.object({ kind: z.literal('skip') }),
  /**
   * letter_trace (P2): the stroke is scored on the client; the response carries the scores.
   * `coverage` = share of the letter's guide path the strokes covered, `precision` = share of the
   * strokes that stayed on the guide (both 0..1). `gradeResponse` owns the pass thresholds.
   * `declined` = "Can't trace now" (send 0 for both scores): it must cost no heart.
   */
  z.object({
    kind: z.literal('trace'),
    coverage: z.number().min(0).max(1),
    precision: z.number().min(0).max(1),
    declined: z.literal(true).optional(),
  }),
])
export type ChallengeResponse = z.infer<typeof ChallengeResponse>

/** Bounds keep every value inside a Postgres `integer` column (and sane): 400, never 500. */
export const MAX_CHALLENGES = 200
/**
 * Attempts one /complete may carry: wrong answers and skips re-queue a challenge, and every
 * matching mismatch is an attempt, so a long practice session can far exceed its challenge count.
 */
export const MAX_ANSWERS = 1_000
export const MAX_ATTEMPT_SEQ = 10_000
export const MAX_ANSWER_MS = 3_600_000

export const AnswerRecord = z.object({
  index: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CHALLENGES - 1),
  attemptSeq: z.number().int().nonnegative().max(MAX_ATTEMPT_SEQ),
  response: ChallengeResponse,
  verdict: Verdict,
  ms: z.number().int().nonnegative().max(MAX_ANSWER_MS),
  hinted: z.boolean().default(false),
})
export type AnswerRecord = z.infer<typeof AnswerRecord>

// ---------------------------------------------------------------------------------------------
// Engagement (P2): leagues, quests, coins and the shop, the practice hub. Every route and field
// here is behind a feature flag (leagues, quests, shop, practiceHub) and absent while it is off.
// ---------------------------------------------------------------------------------------------
/** A league outcome at rollover, and the zone a leaderboard row is in right now. */
export const LeagueOutcome = z.enum(['promote', 'stay', 'demote'])
export type LeagueOutcome = z.infer<typeof LeagueOutcome>

/** A league week: UTC Monday 00:00 to the next Monday 00:00. */
export const LeagueWeek = z.object({ startsAt: IsoDateTime, endsAt: IsoDateTime })
export type LeagueWeek = z.infer<typeof LeagueWeek>

/**
 * One row of the learner's own cohort. Other learners appear only through their public profile
 * fields: never a user id (unknown keys are stripped when the response is validated).
 */
export const LeaderboardEntry = z.object({
  rank: z.number().int().positive(),
  displayName: z.string().nullable(),
  username: z.string().nullable(),
  avatar: z.record(z.string(), z.unknown()).nullable(),
  weeklyXp: z.number().int().nonnegative(),
  isMe: z.boolean(),
  zone: LeagueOutcome,
})
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>

/** How the learner's previous league week ended (the "you moved up" banner). */
export const LeagueResult = z.object({
  week: LeagueWeek,
  /** The tier the learner played that week. */
  tier: LeagueTier,
  rank: z.number().int().positive(),
  outcome: LeagueOutcome,
  newTier: LeagueTier,
  /** Coins won for the final rank (AppConfig.leagues.rewardCoins). */
  coins: z.number().int().nonnegative(),
})
export type LeagueResult = z.infer<typeof LeagueResult>

/** GET /api/leaderboard (linked accounts only): the learner's cohort this week. */
export const LeaderboardResponse = z.object({
  tier: LeagueTier,
  week: LeagueWeek,
  /** False until the learner's first XP of the week places them in a cohort. */
  joined: z.boolean(),
  /** Rank order; empty until joined. */
  members: z.array(LeaderboardEntry).max(MAX_COHORT_SIZE),
  /** How many top ranks move up / bottom ranks move down at rollover (0 at the top/bottom tier). */
  promoteCount: z.number().int().nonnegative(),
  demoteCount: z.number().int().nonnegative(),
  lastResult: LeagueResult.nullable(),
})
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>

/** The home/right-rail league card. */
export const LeagueSummary = z.object({
  tier: LeagueTier,
  joined: z.boolean(),
  rank: z.number().int().positive().nullable(),
  weeklyXp: z.number().int().nonnegative(),
  zone: LeagueOutcome.nullable(),
  endsAt: IsoDateTime,
})
export type LeagueSummary = z.infer<typeof LeagueSummary>

/** What a quest counts; each committed session adds game-rules `questIncrement(metric, …)`. */
export const QuestMetric = z.enum([
  'xp',
  'lessons',
  'perfect_sessions',
  'practice_sessions',
  'letters_sessions',
])
export type QuestMetric = z.infer<typeof QuestMetric>

/** A quest definition id (quest_defs.id): lowercase letters, digits and underscores. */
export const QuestId = z.string().regex(/^[a-z0-9_]{1,40}$/, 'quest id like xp_20')

export const QuestDto = z.object({
  id: QuestId,
  metric: QuestMetric,
  title: z.string(),
  target: z.number().int().positive(),
  /** 0..target (progress stops at the target). */
  progress: z.number().int().nonnegative(),
  completed: z.boolean(),
  /** Coins the quest pays, granted automatically in the commit that completes it. */
  reward: z.number().int().nonnegative(),
})
export type QuestDto = z.infer<typeof QuestDto>

/** GET /api/quests: today's quests in the learner's timezone. */
export const QuestsResponse = z.object({
  date: IsoDate,
  /** The next local midnight, when a new set of quests starts. */
  resetsAt: IsoDateTime,
  quests: z.array(QuestDto).max(10),
})
export type QuestsResponse = z.infer<typeof QuestsResponse>

export const ShopUnavailable = z.enum([
  'insufficient_coins',
  /** Streak freezes: already holding AppConfig.streak.maxFreezes. */
  'max_owned',
  /** Heart refill: hearts are already full. */
  'lives_full',
  /** Heart refill: the learner's lives policy is unlimited. */
  'unlimited_lives',
])
export type ShopUnavailable = z.infer<typeof ShopUnavailable>

export const ShopItem = z.object({
  id: ShopItemId,
  price: z.number().int().positive(),
  /** How many the learner holds (streak freezes); null for items used on purchase (heart refill). */
  owned: z.number().int().nonnegative().nullable(),
  /** The most the learner may hold (streak freezes: AppConfig.streak.maxFreezes); null if uncapped. */
  max: z.number().int().positive().nullable(),
  /** Why the item can't be bought right now; null when it can. */
  unavailable: ShopUnavailable.nullable(),
})
export type ShopItem = z.infer<typeof ShopItem>

/** GET /api/shop. */
export const ShopResponse = z.object({
  coins: z.number().int().nonnegative(),
  items: z.array(ShopItem),
})
export type ShopResponse = z.infer<typeof ShopResponse>

/**
 * POST /api/shop/purchase. `purchaseId` is a client-generated UUID that makes the purchase
 * idempotent: a retry with the same id changes nothing and answers `replayed: true`.
 */
export const PurchaseRequest = z.object({ item: ShopItemId, purchaseId: Uuid })
/** POST /api/lives/refill: buys `heart_refill` (same idempotency rule). */
export const RefillLivesRequest = z.object({ purchaseId: Uuid })
export const PurchaseResponse = z.object({
  purchaseId: Uuid,
  item: ShopItemId,
  /** True when this purchaseId had already been applied (nothing was charged again). */
  replayed: z.boolean(),
  /** The balance after the purchase. */
  coins: z.number().int().nonnegative(),
  streak: StreakView,
  lives: LivesView,
})
export type PurchaseResponse = z.infer<typeof PurchaseResponse>

/** Practice hub modes (P2, flags.practiceHub); a practice session may carry one. */
export const PracticeMode = z.enum(['mixed', 'mistakes', 'listening', 'typing'])
export type PracticeMode = z.infer<typeof PracticeMode>

/** GET /api/practice: which practice modes the learner can start. */
export const PracticeResponse = z.object({
  courseId: z.string(),
  modes: z.array(
    z.object({
      mode: PracticeMode,
      available: z.boolean(),
      /** What the mode would practise (open mistakes, due words, …), when it has a count. */
      count: z.number().int().nonnegative().nullable(),
    }),
  ),
})
export type PracticeResponse = z.infer<typeof PracticeResponse>

/** GET /api/cron/league-rollover (Vercel Cron): closes every ended week, idempotently. */
export const LeagueRolloverResponse = z.object({
  /** Weeks this run closed, oldest first; empty when there was nothing to do. */
  closed: z.array(
    z.object({
      week: LeagueWeek,
      cohorts: z.number().int().nonnegative(),
      members: z.number().int().nonnegative(),
      promoted: z.number().int().nonnegative(),
      demoted: z.number().int().nonnegative(),
    }),
  ),
  /** The open week after the run. */
  current: LeagueWeek,
})
export type LeagueRolloverResponse = z.infer<typeof LeagueRolloverResponse>

// ---------------------------------------------------------------------------------------------
// P2 (Wave 4): speak (flags.speak) and stories (flags.stories). Stories add no route: a story
// level plays through createSession / completeSession (SessionKind `story`, StoryChallenge).
// ---------------------------------------------------------------------------------------------
/** Recording formats `AiClient.transcribe` accepts (iOS Safari records m4a). */
export const SPEECH_AUDIO_FORMATS = ['webm', 'm4a', 'wav', 'mp3'] as const
export const SpeechAudioFormat = z.enum(SPEECH_AUDIO_FORMATS)
export type SpeechAudioFormat = z.infer<typeof SpeechAudioFormat>

/**
 * POST /api/speech/transcribe (flags.speak): one recording for the speak challenge at `index` of
 * the caller's open session. `audio` is standard base64 (padded); the server also enforces
 * AppConfig.speech (maxAudioBytes, maxDurationMs, dailyQuota). The audio is never stored.
 */
export const TranscribeRequest = z.object({
  sessionId: Uuid,
  index: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CHALLENGES - 1),
  format: SpeechAudioFormat,
  audio: z.base64().min(1).max(700_000),
  durationMs: z.number().int().nonnegative().max(30_000),
})
export const TranscribeResponse = z.object({
  transcript: z.string().max(500),
  /** Signed transcript token: send it back in the answer (`{kind: 'audio', transcript, token}`). */
  token: z.string().max(400),
  /** Transcriptions left today (AppConfig.speech.dailyQuota). */
  remaining: z.number().int().nonnegative(),
})
export type TranscribeResponse = z.infer<typeof TranscribeResponse>

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
  dailyGoal: z.object({
    xp: z.number().int(),
    goal: z.number().int(),
    met: z.boolean(),
    justMet: z.boolean(),
  }),
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
  // P2 (optional: results stored before these existed, or with the features off, lack them).
  /** flags.shop/quests: coins this commit granted (quest rewards) and the balance after it. */
  coins: z
    .object({ earned: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
    .optional(),
  /** flags.leagues: the learner's league standing after this commit (linked accounts only). */
  league: z
    .object({
      tier: LeagueTier,
      weeklyXp: z.number().int().nonnegative(),
      rank: z.number().int().positive().nullable(),
      /** The rank before this commit (null when not yet in a cohort). */
      previousRank: z.number().int().positive().nullable(),
      /** True when this commit's XP placed the learner in this week's cohort. */
      joinedNow: z.boolean(),
    })
    .optional(),
  /** flags.quests: today's quests after this commit; `justCompleted` marks the ones it finished. */
  quests: z.array(QuestDto.extend({ justCompleted: z.boolean() })).optional(),
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
  course: z.object({
    id: z.string(),
    contentVersion: z.number().int(),
    currentLevelId: LevelId.nullable(),
  }),
  streak: StreakView,
  lives: LivesView,
  dailyGoal: z.object({ xp: z.number().int(), goal: z.number().int(), met: z.boolean() }),
  xpTotal: z.number().int(),
  settings: Settings,
  flags: Flags,
  // P2 (each present only while its feature flag is on).
  /** flags.shop or flags.quests: the coin balance (the shell shows a coins pill when present). */
  coins: z.number().int().nonnegative().optional(),
  /** flags.leagues: the league card (linked accounts; guests see a "create a profile" card). */
  league: LeagueSummary.optional(),
  /** flags.quests: today's quests (the daily-quests card). */
  quests: z.array(QuestDto).max(10).optional(),
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
  lessons: z.array(
    z.object({ id: LevelId, title: z.string(), letters: z.array(LetterId), state: LevelState }),
  ),
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
export const CreateSessionRequest = z
  .object({
    courseId: z.string().default(DEFAULT_COURSE_ID),
    kind: SessionKind,
    levelId: LevelId.optional(),
    /** The browser's IANA timezone; accepted at most once per AppConfig.tz.minChangeIntervalHours. */
    tz: z.string().min(1),
    /** P2 practice hub (flags.practiceHub): which practice to build. Practice sessions only. */
    mode: PracticeMode.optional(),
    /**
     * P2 speak (flags.speak): the learner's "Can't speak now" pause is running on this device, so
     * the session carries no speak challenges.
     */
    speakPaused: z.boolean().optional(),
  })
  .refine((r) => r.mode === undefined || r.kind === 'practice', {
    message: 'mode is only allowed for practice sessions',
    path: ['mode'],
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
  index: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_CHALLENGES - 1),
  kind: z.literal('wrong'),
})
export const SessionEventResponse = z.object({ lives: LivesView, duplicate: z.boolean() })

export const CompleteSessionRequest = z.object({
  answers: z.array(AnswerRecord).min(1).max(MAX_ANSWERS),
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

export const ReportKind = z.enum([
  'answer_should_be_accepted',
  'audio_problem',
  'content_error',
  'other',
])
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
  /** P2 shop: the balance can't pay for the item (409, like out_of_lives). */
  'insufficient_coins',
  /** P2 speak: today's transcription quota (AppConfig.speech.dailyQuota) is used up (429). */
  'quota_exceeded',
  'internal',
  /**
   * P2: a dependency is not configured or not reachable (a missing APP_SIGNING_SECRET or
   * OPENROUTER_API_KEY_APP, the transcription provider down): 503, retry later.
   */
  'unavailable',
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
  insufficient_coins: 409,
  quota_exceeded: 429,
  internal: 500,
  unavailable: 503,
}
