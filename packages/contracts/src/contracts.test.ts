import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AnswerRecord,
  AppConfig,
  Challenge,
  ChallengeResponse,
  CreateSessionRequest,
  DEFAULT_APP_CONFIG,
  DEFAULT_SETTINGS,
  ERROR_STATUS,
  ErrorCode,
  ErrorEnvelope,
  FLAG_DEFAULTS,
  HomeResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  LeagueRolloverResponse,
  MAX_CHALLENGES,
  MAX_COHORT_SIZE,
  MVP_CHALLENGE_TYPES,
  PracticeMode,
  PracticeResponse,
  PurchaseRequest,
  PurchaseResponse,
  QuestDto,
  QuestMetric,
  QuestsResponse,
  RefillLivesRequest,
  SPEECH_AUDIO_FORMATS,
  SessionKind,
  SessionResult,
  Settings,
  ShopItemId,
  ShopResponse,
  SpeechAudioFormat,
  StoryLineDto,
  TEST_FLAGS_HEADER,
  TEST_NOW_HEADER,
  TEST_TRANSCRIPT_PREFIX,
  TranscribeRequest,
  TranscribeResponse,
  buildPath,
  routes,
  CompleteSessionRequest,
  MAX_ANSWERS,
} from './index'
import type { RouteResponse } from './index'

describe('contracts', () => {
  it('default app config satisfies its schema and covers every session kind', () => {
    const cfg = AppConfig.parse(DEFAULT_APP_CONFIG)
    for (const kind of SessionKind.options) {
      expect(cfg.xp.base[kind]).toBeGreaterThan(0)
      expect(cfg.session.lengths[kind]).toBeGreaterThan(0)
    }
  })

  it('default settings are valid', () => {
    expect(Settings.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('the Challenge union has a member for every MVP challenge type', () => {
    const unionTypes = Challenge.options.map((o) => o.shape.type.value)
    for (const t of MVP_CHALLENGE_TYPES) expect(unionTypes).toContain(t)
  })

  it('every error code maps to an HTTP status', () => {
    for (const code of ErrorCode.options) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400)
  })

  it('routes have unique method+path pairs and valid schemas', () => {
    const seen = new Set<string>()
    for (const [name, r] of Object.entries(routes)) {
      const key = `${r.method} ${r.path}`
      expect(seen.has(key), `${name} duplicates ${key}`).toBe(false)
      seen.add(key)
      expect(r.path.startsWith('/api/')).toBe(true)
      expect(r.response).toBeDefined()
      if (r.method === 'GET') expect(r.request, `${name}: GET routes take no body`).toBeUndefined()
      if (r.auth === 'dev') expect(r.path.startsWith('/api/dev/')).toBe(true)
      expect(Object.keys(DEFAULT_APP_CONFIG.rateLimits)).toContain(r.bucket)
    }
  })

  it('a completion may carry many more attempts than challenges, up to MAX_ANSWERS', () => {
    const answer = (i: number) => ({
      index: i % 20,
      attemptSeq: i,
      response: { kind: 'skip' as const },
      verdict: 'skipped' as const,
      ms: 900,
      graderVersion: 1,
    })
    const body = (n: number) => ({
      answers: Array.from({ length: n }, (_, i) => answer(i)),
      completedAt: '2026-09-25T12:00:00.000Z',
      graderVersion: 1,
    })
    expect(CompleteSessionRequest.safeParse(body(250)).success).toBe(true)
    expect(CompleteSessionRequest.safeParse(body(MAX_ANSWERS)).success).toBe(true)
    expect(CompleteSessionRequest.safeParse(body(MAX_ANSWERS + 1)).success).toBe(false)
  })

  it('buildPath fills params and rejects missing ones', () => {
    expect(buildPath(routes.completeSession.path, { id: 'abc' })).toBe('/api/sessions/abc/complete')
    expect(() => buildPath(routes.completeSession.path)).toThrow()
  })
})

// ------------------------------------------------------------------------------ Wave 3 (P2)
const UUID = '11111111-2222-4333-8444-555555555555'
const WEEK = { startsAt: '2026-09-21T00:00:00.000Z', endsAt: '2026-09-28T00:00:00.000Z' }
const streak = { current: 3, status: 'extended' as const, freezes: 1 }
const lives = { policy: 'hearts' as const, count: 5, max: 5, nextRegenAt: null }
const quest = {
  id: 'xp_20',
  metric: 'xp' as const,
  title: 'Earn 20 XP',
  target: 20,
  progress: 15,
  completed: false,
  reward: 10,
}
const entry = (rank: number) => ({
  rank,
  displayName: `Learner ${rank}`,
  username: null,
  avatar: null,
  weeklyXp: 100 - rank,
  isMe: rank === 2,
  zone: 'stay' as const,
})

/** A /complete result as the MVP stores it (sessions.result): no P2 fields. */
const storedMvpResult = {
  sessionId: UUID,
  kind: 'lesson',
  contentVersion: 1,
  localDate: '2026-09-25',
  xp: { base: 10, bonus: 5, total: 15 },
  accuracy: 1,
  perfect: true,
  durationMs: 61_000,
  streak: { ...streak, extendedToday: true, freezeGranted: false, frozenDates: [] },
  lives,
  dailyGoal: { xp: 15, goal: 20, met: false, justMet: false },
  level: { levelId: 'u01-s0', lessonsDone: 1, lessonsTotal: 1, completed: true },
  mistakes: [],
  graderMismatches: 0,
}

const home = {
  user: {
    id: UUID,
    isAnonymous: false,
    displayName: null,
    username: null,
    ageConfirmed: true,
    onboarded: true,
  },
  course: { id: 'fixture', contentVersion: 1, currentLevelId: 'u01-l1' },
  streak,
  lives,
  dailyGoal: { xp: 15, goal: 20, met: false },
  xpTotal: 15,
  settings: DEFAULT_SETTINGS,
  flags: { ...FLAG_DEFAULTS },
}

describe('contracts: Wave 3 engagement and typing (P2)', () => {
  it('registers the P2 routes with their method, auth and rate-limit bucket', () => {
    const p2 = Object.fromEntries(
      Object.entries(routes)
        .filter(([, r]) => r.phase === 'p2')
        .map(([name, r]) => [name, `${r.method} ${r.path} ${r.auth} ${r.bucket}`]),
    )
    // Wave 4 adds more P2 routes; its block below checks the complete P2 set.
    expect(p2).toMatchObject({
      leaderboard: 'GET /api/leaderboard member default',
      quests: 'GET /api/quests user default',
      shop: 'GET /api/shop user default',
      purchase: 'POST /api/shop/purchase user shop',
      refillLives: 'POST /api/lives/refill user shop',
      practice: 'GET /api/practice user default',
      leagueRollover: 'GET /api/cron/league-rollover cron cron',
    })
    expect(routes.leagueRollover.path.startsWith('/api/cron/')).toBe(true)
  })

  it('every Wave 3 feature flag exists and defaults to off', () => {
    for (const flag of [
      'leagues',
      'quests',
      'shop',
      'practiceHub',
      'persianKeyboard',
      'letterTrace',
    ] as const)
      expect(FLAG_DEFAULTS[flag]).toBe(false)
  })

  it('config defaults: prices, coin rewards, cohort size and the shop/cron rate limits', () => {
    const cfg = AppConfig.parse(DEFAULT_APP_CONFIG)
    expect(cfg.shop.prices).toEqual({ streak_freeze: 100, heart_refill: 150 })
    expect(Object.keys(cfg.shop.prices).sort()).toEqual([...ShopItemId.options].sort())
    expect(cfg.quests).toMatchObject({ perDay: 3, rewardCoins: 10 })
    expect(cfg.leagues).toMatchObject({ cohortSize: 30, rewardCoins: [30, 20, 10] })
    expect(cfg.rateLimits.shop).toEqual({ perMinute: 20 })
    expect(cfg.rateLimits.cron).toEqual({ perMinute: 10 })
    // A cohort holds at most 30 (the league_cohorts.size CHECK).
    const big = {
      ...DEFAULT_APP_CONFIG,
      leagues: { ...DEFAULT_APP_CONFIG.leagues, cohortSize: 31 },
    }
    expect(AppConfig.safeParse(big).success).toBe(false)
    expect(MAX_COHORT_SIZE).toBe(30)
    // Every item needs a price.
    const unpriced = { ...DEFAULT_APP_CONFIG, shop: { prices: { streak_freeze: 100 } } }
    expect(AppConfig.safeParse(unpriced).success).toBe(false)
  })

  it('stored MVP /complete results and MVP home responses still parse', () => {
    const parsed = SessionResult.parse(storedMvpResult)
    expect(parsed).toEqual(storedMvpResult)
    expect(parsed.coins).toBeUndefined()
    expect(HomeResponse.parse(home)).toEqual(home)
  })

  it('P2 fields parse on SessionResult and HomeResponse', () => {
    const result = SessionResult.parse({
      ...storedMvpResult,
      coins: { earned: 10, total: 130 },
      league: { tier: 'mes', weeklyXp: 15, rank: 4, previousRank: null, joinedNow: true },
      quests: [{ ...quest, progress: 20, completed: true, justCompleted: true }],
    })
    expect(result.quests?.[0]?.justCompleted).toBe(true)
    expect(
      SessionResult.safeParse({ ...storedMvpResult, quests: [quest] }).success,
      'result quests carry justCompleted',
    ).toBe(false)
    const withP2 = HomeResponse.parse({
      ...home,
      coins: 120,
      league: {
        tier: 'noqreh',
        joined: true,
        rank: 3,
        weeklyXp: 40,
        zone: 'promote',
        endsAt: WEEK.endsAt,
      },
      quests: [quest],
    })
    expect(withP2.league?.rank).toBe(3)
    expect(HomeResponse.safeParse({ ...home, coins: -1 }).success).toBe(false)
  })

  it('leaderboard rows never carry user ids, and a cohort holds at most 30', () => {
    const row = LeaderboardEntry.parse({ ...entry(1), userId: UUID, user_id: UUID })
    expect(Object.keys(row).sort()).toEqual(
      ['avatar', 'displayName', 'isMe', 'rank', 'username', 'weeklyXp', 'zone'].sort(),
    )
    const board = (n: number) => ({
      tier: 'mes',
      week: WEEK,
      joined: true,
      members: Array.from({ length: n }, (_, i) => entry(i + 1)),
      promoteCount: 7,
      demoteCount: 0,
      lastResult: null,
    })
    expect(LeaderboardResponse.safeParse(board(30)).success).toBe(true)
    expect(LeaderboardResponse.safeParse(board(31)).success).toBe(false)
    expect(
      LeaderboardResponse.parse({
        ...board(0),
        joined: false,
        lastResult: {
          week: WEEK,
          tier: 'mes',
          rank: 1,
          outcome: 'promote',
          newTier: 'noqreh',
          coins: 30,
        },
      }).lastResult?.newTier,
    ).toBe('noqreh')
  })

  it('quests: ids use the quest_defs rule (underscores), metrics are closed', () => {
    expect(
      QuestsResponse.parse({
        date: '2026-09-25',
        resetsAt: '2026-09-26T00:00:00Z',
        quests: [quest],
      }),
    ).toBeTruthy()
    expect(QuestDto.safeParse({ ...quest, id: 'xp-20' }).success).toBe(false)
    expect(QuestDto.safeParse({ ...quest, metric: 'streak' }).success).toBe(false)
    expect(QuestMetric.options).toEqual([
      'xp',
      'lessons',
      'perfect_sessions',
      'practice_sessions',
      'letters_sessions',
    ])
  })

  it('shop and purchases: priced items, idempotent purchase ids, full state back', () => {
    expect(
      ShopResponse.parse({
        coins: 90,
        items: [
          { id: 'streak_freeze', price: 100, owned: 1, max: 2, unavailable: 'insufficient_coins' },
          { id: 'heart_refill', price: 150, owned: null, max: null, unavailable: 'lives_full' },
        ],
      }).items,
    ).toHaveLength(2)
    expect(PurchaseRequest.safeParse({ item: 'streak_freeze', purchaseId: UUID }).success).toBe(
      true,
    )
    expect(PurchaseRequest.safeParse({ item: 'streak_freeze', purchaseId: 'p-1' }).success).toBe(
      false,
    )
    expect(PurchaseRequest.safeParse({ item: 'gems', purchaseId: UUID }).success).toBe(false)
    expect(RefillLivesRequest.safeParse({ purchaseId: UUID }).success).toBe(true)
    expect(
      PurchaseResponse.parse({
        purchaseId: UUID,
        item: 'heart_refill',
        replayed: false,
        coins: 0,
        streak,
        lives,
      }).replayed,
    ).toBe(false)
    expect(ERROR_STATUS.insufficient_coins).toBe(409)
  })

  it('practice hub: modes, and a session mode only for practice sessions', () => {
    expect(PracticeMode.options).toEqual(['mixed', 'mistakes', 'listening', 'typing'])
    expect(
      PracticeResponse.parse({
        courseId: 'fixture',
        modes: [
          { mode: 'mixed', available: true, count: null },
          { mode: 'mistakes', available: false, count: 0 },
        ],
      }).modes,
    ).toHaveLength(2)
    const req = { courseId: 'fixture', kind: 'practice', tz: 'UTC' }
    expect(CreateSessionRequest.parse({ ...req, mode: 'mistakes' }).mode).toBe('mistakes')
    expect(CreateSessionRequest.parse(req).mode).toBeUndefined()
    expect(
      CreateSessionRequest.safeParse({ ...req, kind: 'lesson', levelId: 'u01-s0', mode: 'mixed' })
        .success,
    ).toBe(false)
    expect(CreateSessionRequest.safeParse({ ...req, mode: 'speaking' }).success).toBe(false)
  })

  it('league rollover response: closed weeks and the open one', () => {
    const closed = { week: WEEK, cohorts: 2, members: 41, promoted: 12, demoted: 3 }
    expect(LeagueRolloverResponse.parse({ closed: [closed], current: WEEK }).closed).toHaveLength(1)
    expect(LeagueRolloverResponse.parse({ closed: [], current: WEEK }).closed).toEqual([])
  })

  it('trace responses carry client-side scores in 0..1, optionally declined', () => {
    const trace = { kind: 'trace', coverage: 0.92, precision: 0.8 }
    expect(ChallengeResponse.parse(trace)).toEqual(trace)
    expect(
      ChallengeResponse.parse({ ...trace, coverage: 0, precision: 0, declined: true }),
    ).toMatchObject({
      declined: true,
    })
    expect(ChallengeResponse.safeParse({ ...trace, coverage: 1.2 }).success).toBe(false)
    expect(ChallengeResponse.safeParse({ ...trace, precision: -0.1 }).success).toBe(false)
    expect(ChallengeResponse.safeParse({ ...trace, declined: false }).success).toBe(false)
    const answer = { index: 0, attemptSeq: 0, response: trace, verdict: 'correct', ms: 3000 }
    expect(AnswerRecord.safeParse(answer).success).toBe(true)
  })

  it('reserves the P2 challenge shapes: typed Persian and letter tracing', () => {
    const unionTypes = Challenge.options.map((o) => o.shape.type.value)
    for (const t of ['listen_type', 'cloze_type', 'letter_trace'] as const)
      expect(unionTypes).toContain(t)
    // translate_type carries its direction, so en→fa (typed Persian) needs no new type.
    expect(
      Object.keys(Challenge.options.find((o) => o.shape.type.value === 'translate_type')!.shape),
    ).toEqual(expect.arrayContaining(['direction', 'answerLang', 'graph']))
  })

  it('names the local-mode test headers', () => {
    expect(TEST_NOW_HEADER).toBe('x-test-now')
    expect(TEST_FLAGS_HEADER).toBe('x-test-flags')
  })
})

// ------------------------------------------------------------------------------ Wave 4 (P2)
const audioB64 = Buffer.from(`${TEST_TRANSCRIPT_PREFIX}سلام`, 'utf8').toString('base64')
const transcribe = { sessionId: UUID, index: 3, format: 'webm', audio: audioB64, durationMs: 2400 }
const graph = { v: 1 as const, start: 0, accept: [1], edges: [{ from: 0, to: 1, t: 'سلام' }] }
const speak = {
  index: 0,
  ref: { type: 'speak' as const, items: ['s_u01_0001'] },
  type: 'speak' as const,
  prompt: { fa: 'سلام', translit: 'salām' },
  graph,
}
const leila = { id: 'leila', name: 'Leila', image: '/content/fixture/assets/img/leila.svg' }
const en = (text: string) => ({ lang: 'en' as const, text })
const storyBeat = {
  index: 0,
  ref: { type: 'story' as const, items: ['st_u01_tea'] },
  type: 'story' as const,
  storyId: 'st_u01_tea',
  title: 'Tea with Leila',
  image: '/content/fixture/assets/img/tea.svg',
  beat: 0,
  beats: 3,
  lines: [
    {
      speaker: leila,
      text: { fa: 'سلام، خوبی؟', translit: 'salām, khubi?' },
      en: 'Hello, how are you?',
    },
    { speaker: null, text: { fa: 'مرسی', translit: 'mersi' }, en: 'Thanks' },
  ],
  question: {
    prompt: en('What does Leila offer?'),
    choices: [en('tea'), en('water'), en('bread')],
    answer: 0,
  },
}

describe('contracts: Wave 4 speak and stories (P2)', () => {
  it('registers the transcribe route with its method, auth and rate-limit bucket', () => {
    const p2 = Object.fromEntries(
      Object.entries(routes)
        .filter(([, r]) => r.phase === 'p2')
        .map(([name, r]) => [name, `${r.method} ${r.path} ${r.auth} ${r.bucket}`]),
    )
    expect(p2).toEqual({
      leaderboard: 'GET /api/leaderboard member default',
      quests: 'GET /api/quests user default',
      shop: 'GET /api/shop user default',
      purchase: 'POST /api/shop/purchase user shop',
      refillLives: 'POST /api/lives/refill user shop',
      practice: 'GET /api/practice user default',
      leagueRollover: 'GET /api/cron/league-rollover cron cron',
      transcribe: 'POST /api/speech/transcribe user speech',
    })
    expect(routes.transcribe.request).toBe(TranscribeRequest)
    expect(routes.transcribe.response).toBe(TranscribeResponse)
    expectTypeOf<RouteResponse<'transcribe'>>().toEqualTypeOf<TranscribeResponse>()
  })

  it('the speak and stories flags exist and default to off', () => {
    expect(FLAG_DEFAULTS.speak).toBe(false)
    expect(FLAG_DEFAULTS.stories).toBe(false)
  })

  it('config defaults: story XP and length, speech caps and the speech rate limit', () => {
    const cfg = AppConfig.parse(DEFAULT_APP_CONFIG)
    expect(cfg.xp.base.story).toBe(15)
    expect(cfg.session.lengths.story).toBe(8)
    expect(cfg.speech).toEqual({
      dailyQuota: 60,
      maxAudioBytes: 512_000,
      maxDurationMs: 15_000,
      pauseMinutes: 60,
    })
    expect(cfg.rateLimits.speech).toEqual({ perMinute: 20 })
    // The base64 cap on uploads fits the decoded audio cap (4 characters per 3 bytes).
    expect(Math.ceil(cfg.speech.maxAudioBytes / 3) * 4).toBeLessThanOrEqual(700_000)
    // Mix profiles are unchanged: the gated speaking weight comes with the engine seam.
    for (const profile of Object.values(cfg.mixProfiles))
      expect(profile).not.toHaveProperty('speaking')
    // Each top-level key validates on its own (repos/content.ts loadAppConfig).
    for (const bad of [{ dailyQuota: 0 }, { maxAudioBytes: -1 }, { pauseMinutes: 1.5 }]) {
      const speech = { ...DEFAULT_APP_CONFIG.speech, ...bad }
      expect(AppConfig.shape.speech.safeParse(speech).success, JSON.stringify(bad)).toBe(false)
    }
    // XP is priced for every kind, story included.
    const { story: _story, ...unpriced } = DEFAULT_APP_CONFIG.xp.base
    const xp = { ...DEFAULT_APP_CONFIG.xp, base: unpriced }
    expect(AppConfig.safeParse({ ...DEFAULT_APP_CONFIG, xp }).success).toBe(false)
  })

  it('story is a session kind; payloads from before Wave 4 still parse', () => {
    expect(SessionKind.options).toContain('story')
    const story = { courseId: 'fixture', kind: 'story', levelId: 'u01-st1', tz: 'UTC' }
    expect(CreateSessionRequest.parse(story).kind).toBe('story')
    expect(SessionResult.parse({ ...storedMvpResult, kind: 'story' }).kind).toBe('story')
    // Backward compatibility: stored results, home and MVP requests and answers.
    expect(SessionResult.parse(storedMvpResult)).toEqual(storedMvpResult)
    expect(HomeResponse.parse(home)).toEqual(home)
    expect(Settings.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    const lesson = { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' }
    expect(CreateSessionRequest.parse(lesson).speakPaused).toBeUndefined()
    const audio = { kind: 'audio', transcript: 'سلام' }
    expect(ChallengeResponse.parse(audio)).toEqual(audio)
    expect(Challenge.parse(speak)).toMatchObject({ type: 'speak', isNew: false })
  })

  it('session requests: speakPaused is an optional boolean', () => {
    const req = { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' }
    expect(CreateSessionRequest.parse({ ...req, speakPaused: true }).speakPaused).toBe(true)
    expect(CreateSessionRequest.parse({ ...req, speakPaused: false }).speakPaused).toBe(false)
    expect(CreateSessionRequest.safeParse({ ...req, speakPaused: 'yes' }).success).toBe(false)
    // The Wave 3 rule still holds next to the new field.
    const withMode = { ...req, mode: 'mixed', speakPaused: true }
    expect(CreateSessionRequest.safeParse(withMode).success).toBe(false)
  })

  it('speak: audio answers carry the transcript token or decline; speak shows a translation', () => {
    const answer = { kind: 'audio', transcript: 'سلام', token: 'v1.payload.signature' }
    expect(ChallengeResponse.parse(answer)).toEqual(answer)
    const declined = { kind: 'audio', transcript: '', declined: true }
    expect(ChallengeResponse.parse(declined)).toEqual(declined)
    expect(ChallengeResponse.safeParse({ ...answer, declined: false }).success).toBe(false)
    expect(ChallengeResponse.safeParse({ ...answer, token: 'x'.repeat(401) }).success).toBe(false)
    expect(ChallengeResponse.safeParse({ ...answer, token: 42 }).success).toBe(false)
    const long = { ...answer, transcript: 'x'.repeat(501) }
    expect(ChallengeResponse.safeParse(long).success).toBe(false)
    const record = { index: 0, attemptSeq: 0, response: answer, verdict: 'correct', ms: 900 }
    expect(AnswerRecord.safeParse(record).success).toBe(true)
    expect(Challenge.parse({ ...speak, translation: 'Hello' })).toMatchObject({
      translation: 'Hello',
    })
    expect(Challenge.safeParse({ ...speak, translation: 7 }).success).toBe(false)
  })

  it('transcribe: request caps and response shape', () => {
    expect(TEST_TRANSCRIPT_PREFIX).toBe('zaboon-test-transcript:')
    expect(SPEECH_AUDIO_FORMATS).toEqual(['webm', 'm4a', 'wav', 'mp3'])
    expect(SpeechAudioFormat.options).toEqual([...SPEECH_AUDIO_FORMATS])
    expect(TranscribeRequest.parse(transcribe)).toEqual(transcribe)
    for (const format of SPEECH_AUDIO_FORMATS)
      expect(TranscribeRequest.safeParse({ ...transcribe, format }).success).toBe(true)
    const invalid = [
      { sessionId: 'not-a-uuid' },
      { index: -1 },
      { index: MAX_CHALLENGES },
      { index: 1.5 },
      { format: 'ogg' },
      { audio: '' },
      { audio: 'not base64!' },
      { audio: 'A'.repeat(700_004) },
      { durationMs: -1 },
      { durationMs: 30_001 },
    ]
    for (const patch of invalid) {
      const label = JSON.stringify(patch).slice(0, 60)
      expect(TranscribeRequest.safeParse({ ...transcribe, ...patch }).success, label).toBe(false)
    }
    const biggest = { ...transcribe, audio: 'A'.repeat(700_000) }
    expect(TranscribeRequest.safeParse(biggest).success).toBe(true)
    const res = { transcript: 'سلام', token: 'v1.payload.signature', remaining: 59 }
    expect(TranscribeResponse.parse(res)).toEqual(res)
    expect(TranscribeResponse.safeParse({ ...res, remaining: -1 }).success).toBe(false)
    expect(TranscribeResponse.safeParse({ ...res, token: 'x'.repeat(401) }).success).toBe(false)
    const long = { ...res, transcript: 'x'.repeat(501) }
    expect(TranscribeResponse.safeParse(long).success).toBe(false)
    expect(TranscribeResponse.safeParse({ transcript: 'سلام', remaining: 1 }).success).toBe(false)
  })

  it('story challenges: a beat of lines (null speaker = narrator) and an optional question', () => {
    expect(Challenge.parse(storyBeat)).toMatchObject({ type: 'story', beat: 0, beats: 3 })
    expect(StoryLineDto.parse(storyBeat.lines[1]).speaker).toBeNull()
    // The closing beat has no question (it is answered {kind: 'none'}).
    const { question: _question, ...closing } = { ...storyBeat, beat: 2 }
    expect(Challenge.parse(closing)).not.toHaveProperty('question')
    const line = storyBeat.lines[0]!
    const q = storyBeat.question
    const invalid: Record<string, unknown> = {
      'no lines': { ...storyBeat, lines: [] },
      '31 lines': { ...storyBeat, lines: Array.from({ length: 31 }, () => line) },
      'no beats': { ...storyBeat, beats: 0 },
      'negative beat': { ...storyBeat, beat: -1 },
      'no title': { ...storyBeat, title: undefined },
      'speaker without a name': { ...storyBeat, lines: [{ ...line, speaker: { id: 'leila' } }] },
      'text without translit': { ...storyBeat, lines: [{ ...line, text: { fa: 'سلام' } }] },
      'line without translation': { ...storyBeat, lines: [{ ...line, en: undefined }] },
      'one choice': { ...storyBeat, question: { ...q, choices: [en('tea')] } },
      'five choices': { ...storyBeat, question: { ...q, choices: 'abcde'.split('').map(en) } },
      'negative answer': { ...storyBeat, question: { ...q, answer: -1 } },
    }
    for (const [name, value] of Object.entries(invalid))
      expect(Challenge.safeParse(value).success, name).toBe(false)
    // The placeholder shape reserved in Wave 0 (no build path ever emitted it) no longer parses.
    const placeholder = { index: 0, ref: storyBeat.ref, type: 'story', storyId: 'st_u01_tea' }
    expect(Challenge.safeParse(placeholder).success).toBe(false)
    // Beats answer with a choice, or `none` for the closing beat.
    for (const response of [{ kind: 'choice', value: 0 }, { kind: 'none' }])
      expect(ChallengeResponse.safeParse(response).success).toBe(true)
  })

  it('error codes: quota_exceeded is a 429 and unavailable a 503', () => {
    expect(ERROR_STATUS.quota_exceeded).toBe(429)
    expect(ERROR_STATUS.unavailable).toBe(503)
    for (const code of ['quota_exceeded', 'unavailable'] as const)
      expect(ErrorEnvelope.parse({ error: { code, message: 'x' } }).error.code).toBe(code)
  })
})
