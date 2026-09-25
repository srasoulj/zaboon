/**
 * @zaboon/game-rules: XP, local dates, streaks, lives, leagues and quests as pure functions
 * (docs/ARCHITECTURE.md §6). The server is authoritative; the client uses these for display only.
 *
 * Owner: ws-engine. The executable spec is packages/game-rules/oracles/*.yaml (read-only). Every
 * rule the route handlers need has a function here, so ws-api never re-implements game math:
 * `clampActivityTime`/`localDateFor`, `acceptTzChange`, `applyActivity`/`streakView`,
 * `applyMistakeEvent`/`settleCommit` (hearts), `sessionXp`/`dailyGoalStep`, `placeInCohort`/
 * `rolloverCohort` and `dailyQuests`.
 */
import type {
  AppConfig,
  LeagueTier,
  LivesState,
  LivesView,
  SessionKind,
  StreakState,
  StreakView,
} from '@zaboon/contracts'
import { LEAGUE_TIERS } from '@zaboon/contracts'

export const IMPLEMENTATION: 'stub' | 'real' = 'real'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ------------------------------------------------------------------------------------------ dates
/** Calendar date (YYYY-MM-DD) of `instant` in an IANA timezone. */
export function dateInZone(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The instant a completed session counts at: the client's completedAt clamped to
 * [startedAt, now] (a late request still counts for the right day; a future clock never does).
 */
export function clampActivityTime(at: { completedAt: Date; startedAt: Date }, now: Date): Date {
  const t = Math.min(Math.max(at.completedAt.getTime(), at.startedAt.getTime()), now.getTime())
  return new Date(t)
}

/** The local date a completed session counts for: clamp completedAt to [startedAt, now], then convert. */
export function localDateFor(input: {
  completedAt: Date
  startedAt: Date
  now: Date
  tz: string
}): string {
  return dateInZone(clampActivityTime(input, input.now), input.tz)
}

/**
 * Accepts a timezone change at most once per `minChangeIntervalHours` (elapsed time).
 * `tzChangedAt` is the value to store: `now` when the change is accepted, else unchanged.
 */
export function acceptTzChange(
  current: { tz: string; tzChangedAt: Date | null },
  requested: string,
  now: Date,
  cfg: AppConfig,
): { tz: string; changed: boolean; tzChangedAt: Date | null } {
  const unchanged = { tz: current.tz, changed: false, tzChangedAt: current.tzChangedAt }
  if (requested === current.tz) return unchanged
  const ok =
    current.tzChangedAt === null ||
    now.getTime() - current.tzChangedAt.getTime() >= cfg.tz.minChangeIntervalHours * HOUR_MS
  return ok ? { tz: requested, changed: true, tzChangedAt: now } : unchanged
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS,
  )
}

// ----------------------------------------------------------------------------------------- streak
export function initialStreak(cfg: AppConfig): StreakState {
  return {
    current: 0,
    longest: 0,
    lastActiveDate: null,
    freezes: Math.min(cfg.streak.signupFreezes, cfg.streak.maxFreezes),
  }
}

export interface ActivityResult {
  state: StreakState
  /** True when this activity extended (or started) the streak. */
  extendedToday: boolean
  /** True only when a milestone actually added a freeze (never at the cap). */
  freezeGranted: boolean
  /** Missed dates covered by consumed freezes, ascending. */
  frozenDates: string[]
}

/**
 * Applies a completed session on local date `date` (ARCHITECTURE §6 / oracles/streak.yaml).
 * Same day or an earlier date: no change. Next day: +1. A gap: freezes cover missed days; if they
 * cannot cover all of them, the freezes that exist are still consumed and the streak restarts at 1.
 * Every `freezeEveryDays` milestone grants a freeze up to `maxFreezes`.
 */
export function applyActivity(state: StreakState, date: string, cfg: AppConfig): ActivityResult {
  const s = { ...state }
  const unchanged = { state: s, extendedToday: false, freezeGranted: false, frozenDates: [] }
  const before = s.current
  const frozenDates: string[] = []
  if (s.lastActiveDate === null) s.current = 1
  else {
    const d = daysBetween(s.lastActiveDate, date)
    if (d <= 0) return unchanged
    if (d === 1) s.current += 1
    else {
      const gap = d - 1
      const consumed = Math.min(gap, s.freezes)
      for (let i = 1; i <= consumed; i++) frozenDates.push(addDays(s.lastActiveDate, i))
      s.freezes -= consumed
      s.current = gap <= consumed ? s.current + 1 : 1
    }
  }
  s.lastActiveDate = date
  s.longest = Math.max(s.longest, s.current)
  let freezeGranted = false
  if (
    s.current > before &&
    s.current % cfg.streak.freezeEveryDays === 0 &&
    s.freezes < cfg.streak.maxFreezes
  ) {
    s.freezes += 1
    freezeGranted = true
  }
  return { state: s, extendedToday: true, freezeGranted, frozenDates }
}

/**
 * Read-only display state. Never mutates. `freezes` is the stored count (pending consumption is
 * written at the next commit). A lastActiveDate after `today` (westward tz change) reads as extended.
 */
export function streakView(state: StreakState, today: string): StreakView {
  const base = { current: state.current, freezes: state.freezes }
  if (state.lastActiveDate === null) return { ...base, current: 0, status: 'none' }
  const d = daysBetween(state.lastActiveDate, today)
  if (d <= 0) return { ...base, status: 'extended' }
  if (d === 1) return { ...base, status: 'at_risk' }
  const gap = d - 1
  if (gap <= state.freezes) return { ...base, status: 'frozen', freezesNeeded: gap }
  return { ...base, current: 0, status: 'broken' }
}

// ------------------------------------------------------------------------------------------ lives
/** The part of a lives state every policy shares: a count that regenerates from `updatedAt`. */
export interface RegenState {
  count: number
  updatedAt: string
}

/**
 * Pluggable lives mechanic (ADR 0007). MVP: hearts. The type parameters default to the contract
 * shapes (hearts / unlimited); the P2 energy experiment plugs in its own state and view.
 */
export interface LivesPolicy<
  Name extends string = LivesState['policy'],
  S extends RegenState = LivesState,
  V = LivesView,
> {
  name: Name
  view(state: S, now: Date, cfg: AppConfig): V
  loseOne(state: S, now: Date, cfg: AppConfig): S
  reward(state: S, amount: number, now: Date, cfg: AppConfig): S
}

export function initialLives(now: Date, cfg: AppConfig): LivesState {
  return { policy: 'hearts', count: cfg.hearts.max, updatedAt: now.toISOString() }
}

interface RegenParams {
  max: number
  regenMinutes: number
}

/**
 * Lazy regeneration at `now`: units = max(0, floor((now - updatedAt) / regen)) (clock skew never
 * subtracts); count = min(max, count + units); updatedAt = now when full, else it advances by whole
 * units only, so partial progress towards the next unit is kept.
 */
function materialize<S extends RegenState>(state: S, now: Date, p: RegenParams): S {
  const regenMs = p.regenMinutes * MINUTE_MS
  const since = now.getTime() - new Date(state.updatedAt).getTime()
  const units = Math.max(0, Math.floor(since / regenMs))
  const count = Math.min(p.max, state.count + units)
  const updatedAt =
    count >= p.max
      ? now.toISOString()
      : new Date(new Date(state.updatedAt).getTime() + units * regenMs).toISOString()
  return { ...state, count, updatedAt }
}

function regenView(
  state: RegenState,
  now: Date,
  p: RegenParams,
): { count: number; max: number; nextRegenAt: string | null } {
  const m = materialize(state, now, p)
  const next =
    m.count >= p.max
      ? null
      : new Date(new Date(m.updatedAt).getTime() + p.regenMinutes * MINUTE_MS).toISOString()
  return { count: m.count, max: p.max, nextRegenAt: next }
}

function regenSpend<S extends RegenState>(state: S, amount: number, now: Date, p: RegenParams): S {
  const m = materialize(state, now, p)
  const wasFull = m.count >= p.max
  // Leaving "full" starts the regeneration clock now; otherwise the partial unit keeps running.
  return {
    ...m,
    count: Math.max(0, m.count - amount),
    updatedAt: wasFull ? now.toISOString() : m.updatedAt,
  }
}

function regenAdd<S extends RegenState>(state: S, amount: number, now: Date, p: RegenParams): S {
  // updatedAt stays as materialized (oracle ht-24): while full it is irrelevant, because the next
  // loss materializes to max and restarts the clock at that instant.
  const m = materialize(state, now, p)
  return { ...m, count: Math.min(p.max, m.count + amount) }
}

const heartsParams = (cfg: AppConfig): RegenParams => ({
  max: cfg.hearts.max,
  regenMinutes: cfg.hearts.regenMinutes,
})

export const heartsPolicy: LivesPolicy = {
  name: 'hearts',
  view: (state, now, cfg) => ({ policy: 'hearts', ...regenView(state, now, heartsParams(cfg)) }),
  loseOne: (state, now, cfg) => regenSpend(state, 1, now, heartsParams(cfg)),
  reward: (state, amount, now, cfg) => regenAdd(state, amount, now, heartsParams(cfg)),
}

export const unlimitedPolicy: LivesPolicy = {
  name: 'unlimited',
  view: (_s, _n, cfg) => ({
    policy: 'unlimited',
    count: cfg.hearts.max,
    max: cfg.hearts.max,
    nextRegenAt: null,
  }),
  loseOne: (s) => s,
  reward: (s) => s,
}

export function livesPolicy(name: LivesState['policy']): LivesPolicy {
  return name === 'unlimited' ? unlimitedPolicy : heartsPolicy
}

/** Idempotency key of a wrong-attempt event: (sessionId, attemptSeq). */
export function wrongEventKey(sessionId: string, attemptSeq: number): string {
  return `${sessionId}:${attemptSeq}`
}

export interface MistakeEventInput {
  state: LivesState
  kind: SessionKind
  sessionId: string
  attemptSeq: number
  /** Keys (wrongEventKey) of the events already recorded. */
  recorded: ReadonlySet<string>
  now: Date
  cfg: AppConfig
}

/**
 * One wrong-attempt event (POST /api/sessions/:id/events). A repeated (sessionId, attemptSeq) is a
 * duplicate and changes nothing; otherwise the event must be recorded (`key`) and costs one life,
 * except in practice sessions, which never cost hearts.
 */
export function applyMistakeEvent(input: MistakeEventInput): {
  duplicate: boolean
  key: string
  state: LivesState
} {
  const key = wrongEventKey(input.sessionId, input.attemptSeq)
  if (input.recorded.has(key)) return { duplicate: true, key, state: input.state }
  const policy = livesPolicy(input.state.policy)
  const state =
    input.kind === 'practice' ? input.state : policy.loseOne(input.state, input.now, input.cfg)
  return { duplicate: false, key, state }
}

/** Server-graded wrong answers whose events never arrived: max(0, serverWrong - recorded events). */
export function extraHeartsToCharge(serverWrong: number, recordedEvents: number): number {
  return Math.max(0, serverWrong - recordedEvents)
}

export interface SettleCommitInput {
  state: LivesState
  kind: SessionKind
  /** Wrong attempts found when the server re-graded the session. */
  serverWrong: number
  /** Distinct wrong-attempt events recorded for this session. */
  recordedEvents: number
  now: Date
  cfg: AppConfig
}

/**
 * Hearts reconciliation at commit (oracles/hearts.yaml): `extra` is always reported; it is charged
 * one life at a time except in practice, which instead earns `hearts.practiceReward` (capped).
 * The unlimited policy never changes the state.
 */
export function settleCommit(input: SettleCommitInput): { extra: number; state: LivesState } {
  const extra = extraHeartsToCharge(input.serverWrong, input.recordedEvents)
  const policy = livesPolicy(input.state.policy)
  let state = input.state
  if (input.kind === 'practice')
    state = policy.reward(state, input.cfg.hearts.practiceReward, input.now, input.cfg)
  else for (let i = 0; i < extra; i++) state = policy.loseOne(state, input.now, input.cfg)
  return { extra, state }
}

// ----------------------------------------------------------------------------- energy (P2, off)
/** Energy experiment parameters (ADR 0007). Not in AppConfig yet: see the PR's contract request. */
export interface EnergyConfig {
  max: number
  regenMinutes: number
  /** Energy each challenge costs; reserved when the session starts. */
  costPerChallenge: number
  /** Consecutive correct answers that refund `refund` energy. */
  refundEvery: number
  refund: number
}

export const DEFAULT_ENERGY_CONFIG: EnergyConfig = {
  max: 25,
  regenMinutes: 30,
  costPerChallenge: 1,
  refundEvery: 5,
  refund: 1,
}

export interface EnergyState extends RegenState {
  policy: 'energy'
}

export interface EnergyView {
  policy: 'energy'
  count: number
  max: number
  nextRegenAt: string | null
}

export interface EnergyPolicy extends LivesPolicy<'energy', EnergyState, EnergyView> {
  initial(now: Date): EnergyState
  /** Reserves the cost of `challenges` at session start (as much as is available). */
  reserve(
    state: EnergyState,
    challenges: number,
    now: Date,
  ): { state: EnergyState; reserved: number }
  /**
   * Settles a session at commit: challenges actually answered cost energy, the unused reservation
   * comes back, and every `refundEvery` consecutive correct answers refund `refund`. Re-queued
   * mistake reviews are free (they are not counted in `answered`).
   */
  settle(
    state: EnergyState,
    s: { reserved: number; answered: number; correctRuns: readonly number[] },
    now: Date,
  ): EnergyState
}

/** Energy behind the LivesPolicy seam (P2 experiment, not used by default). */
export function energyPolicy(ecfg: EnergyConfig = DEFAULT_ENERGY_CONFIG): EnergyPolicy {
  const p: RegenParams = { max: ecfg.max, regenMinutes: ecfg.regenMinutes }
  return {
    name: 'energy',
    initial: (now) => ({ policy: 'energy', count: ecfg.max, updatedAt: now.toISOString() }),
    view: (state, now) => ({ policy: 'energy', ...regenView(state, now, p) }),
    loseOne: (state, now) => regenSpend(state, ecfg.costPerChallenge, now, p),
    reward: (state, amount, now) => regenAdd(state, amount, now, p),
    reserve(state, challenges, now) {
      const available = materialize(state, now, p).count
      const reserved = Math.min(available, Math.max(0, challenges) * ecfg.costPerChallenge)
      return { state: regenSpend(state, reserved, now, p), reserved }
    },
    settle(state, s, now) {
      const cost = Math.min(s.reserved, Math.max(0, s.answered) * ecfg.costPerChallenge)
      const refunds = s.correctRuns.reduce(
        (n, run) => n + Math.floor(Math.max(0, run) / ecfg.refundEvery),
        0,
      )
      return regenAdd(state, s.reserved - cost + refunds * ecfg.refund, now, p)
    },
  }
}

// --------------------------------------------------------------------------------------------- xp
export function xpFor(
  kind: SessionKind,
  perfect: boolean,
  cfg: AppConfig,
): { base: number; bonus: number; total: number } {
  const base = cfg.xp.base[kind]
  const bonus = perfect ? cfg.xp.perfectBonus : 0
  return { base, bonus, total: base + bonus }
}

/** Session XP from the server's wrong-attempt count: perfect = zero wrong attempts (every kind). */
export function sessionXp(
  kind: SessionKind,
  wrongAttempts: number,
  cfg: AppConfig,
): { base: number; bonus: number; total: number; perfect: boolean } {
  const perfect = wrongAttempts === 0
  return { ...xpFor(kind, perfect, cfg), perfect }
}

export function dailyGoalStatus(
  xp: number,
  goal: number,
): { xp: number; goal: number; met: boolean } {
  return { xp, goal, met: xp >= goal }
}

/** Adds a session's XP to its local day's total: {dayXp, met, justMet} after the commit. */
export function dailyGoalStep(
  dayXpBefore: number,
  sessionXpTotal: number,
  goal: number,
): { sessionXp: number; dayXp: number; goal: number; met: boolean; justMet: boolean } {
  const before = dailyGoalStatus(dayXpBefore, goal)
  const after = dailyGoalStatus(dayXpBefore + sessionXpTotal, goal)
  return {
    sessionXp: sessionXpTotal,
    dayXp: after.xp,
    goal,
    met: after.met,
    justMet: after.met && !before.met,
  }
}

// ---------------------------------------------------------------------------------------- leagues
export interface OpenCohort {
  id: string
  size: number
  createdOrder: number
}

/** Fullest open cohort with room (tie → oldest), or null to create a new one. */
export function placeInCohort(open: readonly OpenCohort[], cfg: AppConfig): string | null {
  const candidates = open.filter((c) => c.size < cfg.leagues.cohortSize)
  candidates.sort((a, b) => b.size - a.size || a.createdOrder - b.createdOrder)
  return candidates[0]?.id ?? null
}

export interface CohortMember {
  userId: string
  weeklyXp: number
}
export type LeagueOutcome = 'promote' | 'stay' | 'demote'

/**
 * Weekly rollover of one cohort: rank by weeklyXp desc (ties: userId ascending); the top
 * min(promote, ceil(n/4)) move up (none in the top tier), the bottom min(demote, floor(n/5)) move
 * down (none in the bottom tier). Promotion wins if a member would be both.
 */
export function rolloverCohort(
  members: readonly CohortMember[],
  tier: LeagueTier,
  cfg: AppConfig,
): { userId: string; rank: number; outcome: LeagueOutcome; nextTier: LeagueTier }[] {
  const sorted = [...members].sort(
    (a, b) => b.weeklyXp - a.weeklyXp || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  )
  const n = sorted.length
  const ti = LEAGUE_TIERS.indexOf(tier)
  const promote =
    ti === LEAGUE_TIERS.length - 1
      ? 0
      : Math.max(0, Math.min(cfg.leagues.promote, Math.ceil(n / 4)))
  const demote = ti === 0 ? 0 : Math.max(0, Math.min(cfg.leagues.demote, Math.floor(n / 5)))
  return sorted.map((m, i) => {
    const outcome: LeagueOutcome = i < promote ? 'promote' : i >= n - demote ? 'demote' : 'stay'
    const nextTier = LEAGUE_TIERS[ti + (outcome === 'promote' ? 1 : outcome === 'demote' ? -1 : 0)]!
    return { userId: m.userId, rank: i + 1, outcome, nextTier }
  })
}

// ----------------------------------------------------------------------------------------- quests
/** What a quest counts. Each committed session adds `questIncrement(metric, session)`. */
export type QuestMetric =
  'xp' | 'lessons' | 'perfect_sessions' | 'practice_sessions' | 'letters_sessions'

export interface QuestTemplate {
  id: string
  metric: QuestMetric
  target: number
  title: string
}

/**
 * The daily quest templates (ARCHITECTURE §6, P2). Ids are stable: stored progress refers to them,
 * and they follow the quest_defs.id rule (`^[a-z0-9_]{1,40}$`). The engagement migration seeds
 * quest_defs with exactly these rows (a drift test checks it).
 */
export const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  { id: 'xp_20', metric: 'xp', target: 20, title: 'Earn 20 XP' },
  { id: 'xp_40', metric: 'xp', target: 40, title: 'Earn 40 XP' },
  { id: 'xp_60', metric: 'xp', target: 60, title: 'Earn 60 XP' },
  { id: 'lessons_1', metric: 'lessons', target: 1, title: 'Complete a lesson' },
  { id: 'lessons_2', metric: 'lessons', target: 2, title: 'Complete 2 lessons' },
  { id: 'lessons_3', metric: 'lessons', target: 3, title: 'Complete 3 lessons' },
  {
    id: 'perfect_1',
    metric: 'perfect_sessions',
    target: 1,
    title: 'Finish a session with no mistakes',
  },
  {
    id: 'perfect_2',
    metric: 'perfect_sessions',
    target: 2,
    title: 'Finish 2 sessions with no mistakes',
  },
  {
    id: 'practice_1',
    metric: 'practice_sessions',
    target: 1,
    title: 'Complete a practice session',
  },
  { id: 'letters_1', metric: 'letters_sessions', target: 1, title: 'Complete a letters lesson' },
]

export interface DailyQuest {
  /** Stable per (date, template): `${date}:${templateId}`. */
  id: string
  date: string
  templateId: string
  metric: QuestMetric
  target: number
  title: string
}

/** FNV-1a 32-bit string hash. */
function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mulberry32: a small deterministic PRNG in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The user's quests for a local date: `cfg.quests.perDay` templates with distinct metrics, chosen
 * deterministically from (userId, date), so every server call and every retry agrees.
 */
export function dailyQuests(
  userId: string,
  date: string,
  cfg: AppConfig,
  templates: readonly QuestTemplate[] = QUEST_TEMPLATES,
): DailyQuest[] {
  const rnd = mulberry32(hash32(`quests:${userId}:${date}`))
  const byMetric = new Map<QuestMetric, QuestTemplate[]>()
  for (const t of templates) byMetric.set(t.metric, [...(byMetric.get(t.metric) ?? []), t])
  const metrics = [...byMetric.keys()]
  for (let i = metrics.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[metrics[i], metrics[j]] = [metrics[j]!, metrics[i]!]
  }
  return metrics.slice(0, Math.max(0, cfg.quests.perDay)).map((metric) => {
    const options = byMetric.get(metric)!
    const t = options[Math.floor(rnd() * options.length)]!
    return {
      id: `${date}:${t.id}`,
      date,
      templateId: t.id,
      metric: t.metric,
      target: t.target,
      title: t.title,
    }
  })
}

/** How much one committed session advances a quest metric. */
export function questIncrement(
  metric: QuestMetric,
  session: { kind: SessionKind; xp: number; perfect: boolean },
): number {
  switch (metric) {
    case 'xp':
      return session.xp
    case 'lessons':
      return session.kind === 'lesson' ? 1 : 0
    case 'perfect_sessions':
      return session.perfect ? 1 : 0
    case 'practice_sessions':
      return session.kind === 'practice' ? 1 : 0
    case 'letters_sessions':
      return session.kind === 'letters' ? 1 : 0
  }
}

// ---------------------------------------------------------------------------- engagement (P2)
// League weeks and XP, rollover plan, coin grants, quest progress and the shop
// (oracles/engagement.yaml).
export * from './engagement'
