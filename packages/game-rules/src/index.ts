/**
 * @zaboon/game-rules: XP, local dates, streaks, lives, leagues and quests as pure functions
 * (docs/ARCHITECTURE.md §6). The server is authoritative; the client uses these for display only.
 *
 * Wave 0 STUB with naive behavior. Owner: ws-engine, who must pass
 * packages/game-rules/oracles/*.yaml (READ-ONLY, orchestrator-owned). Keep signatures stable.
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

export const IMPLEMENTATION: 'stub' | 'real' = 'stub'

// ------------------------------------------------------------------------------------------ dates
/** Calendar date (YYYY-MM-DD) of `instant` in an IANA timezone. */
export function dateInZone(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The local date a completed session counts for: clamp completedAt to [startedAt, now], then convert. */
export function localDateFor(input: { completedAt: Date; startedAt: Date; now: Date; tz: string }): string {
  const t = Math.min(Math.max(input.completedAt.getTime(), input.startedAt.getTime()), input.now.getTime())
  return dateInZone(new Date(t), input.tz)
}

/** Accepts a timezone change at most once per `minChangeIntervalHours`. */
export function acceptTzChange(
  current: { tz: string; tzChangedAt: Date | null },
  requested: string,
  now: Date,
  cfg: AppConfig,
): { tz: string; changed: boolean } {
  if (requested === current.tz) return { tz: current.tz, changed: false }
  const ok =
    current.tzChangedAt === null ||
    now.getTime() - current.tzChangedAt.getTime() >= cfg.tz.minChangeIntervalHours * 3_600_000
  return ok ? { tz: requested, changed: true } : { tz: current.tz, changed: false }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000)
}

// ----------------------------------------------------------------------------------------- streak
export function initialStreak(cfg: AppConfig): StreakState {
  return { current: 0, longest: 0, lastActiveDate: null, freezes: cfg.streak.signupFreezes }
}

export interface ActivityResult {
  state: StreakState
  extendedToday: boolean
  freezeGranted: boolean
  frozenDates: string[]
}

/** Applies a completed session on local date `date` (ARCHITECTURE §6 / oracles/streak.yaml). */
export function applyActivity(state: StreakState, date: string, cfg: AppConfig): ActivityResult {
  const s = { ...state }
  const before = s.current
  const frozenDates: string[] = []
  if (s.lastActiveDate === null) s.current = 1
  else if (date === s.lastActiveDate) return { state: s, extendedToday: false, freezeGranted: false, frozenDates }
  else if (daysBetween(s.lastActiveDate, date) === 1) s.current += 1
  else if (daysBetween(s.lastActiveDate, date) > 1) {
    const gap = daysBetween(s.lastActiveDate, date) - 1
    const consumed = Math.min(gap, s.freezes)
    for (let i = 1; i <= consumed; i++) frozenDates.push(addDays(s.lastActiveDate, i))
    const had = s.freezes
    s.freezes -= consumed
    s.current = gap <= had ? s.current + 1 : 1
  } else return { state: s, extendedToday: false, freezeGranted: false, frozenDates }
  s.lastActiveDate = s.lastActiveDate === null || date > s.lastActiveDate ? date : s.lastActiveDate
  s.longest = Math.max(s.longest, s.current)
  let freezeGranted = false
  if (s.current > before && s.current % cfg.streak.freezeEveryDays === 0 && s.freezes < cfg.streak.maxFreezes) {
    s.freezes += 1
    freezeGranted = true
  }
  return { state: s, extendedToday: true, freezeGranted, frozenDates }
}

/** Read-only display state. Never mutates. */
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
/** Pluggable lives mechanic (ADR 0007). MVP: hearts. */
export interface LivesPolicy {
  name: 'hearts' | 'unlimited'
  view(state: LivesState, now: Date, cfg: AppConfig): LivesView
  loseOne(state: LivesState, now: Date, cfg: AppConfig): LivesState
  reward(state: LivesState, amount: number, now: Date, cfg: AppConfig): LivesState
}

export function initialLives(now: Date, cfg: AppConfig): LivesState {
  return { policy: 'hearts', count: cfg.hearts.max, updatedAt: now.toISOString() }
}

function materialize(state: LivesState, now: Date, cfg: AppConfig): LivesState {
  const regenMs = cfg.hearts.regenMinutes * 60_000
  const since = now.getTime() - new Date(state.updatedAt).getTime()
  const units = Math.max(0, Math.floor(since / regenMs))
  const count = Math.min(cfg.hearts.max, state.count + units)
  const updatedAt =
    count >= cfg.hearts.max ? now.toISOString() : new Date(new Date(state.updatedAt).getTime() + units * regenMs).toISOString()
  return { ...state, count, updatedAt }
}

export const heartsPolicy: LivesPolicy = {
  name: 'hearts',
  view(state, now, cfg) {
    const m = materialize(state, now, cfg)
    const next =
      m.count >= cfg.hearts.max ? null : new Date(new Date(m.updatedAt).getTime() + cfg.hearts.regenMinutes * 60_000).toISOString()
    return { policy: 'hearts', count: m.count, max: cfg.hearts.max, nextRegenAt: next }
  },
  loseOne(state, now, cfg) {
    const m = materialize(state, now, cfg)
    const wasFull = m.count >= cfg.hearts.max
    return { ...m, count: Math.max(0, m.count - 1), updatedAt: wasFull ? now.toISOString() : m.updatedAt }
  },
  reward(state, amount, now, cfg) {
    const m = materialize(state, now, cfg)
    return { ...m, count: Math.min(cfg.hearts.max, m.count + amount) }
  },
}

export const unlimitedPolicy: LivesPolicy = {
  name: 'unlimited',
  view: (_s, _n, cfg) => ({ policy: 'unlimited', count: cfg.hearts.max, max: cfg.hearts.max, nextRegenAt: null }),
  loseOne: (s) => s,
  reward: (s) => s,
}

export function livesPolicy(name: LivesState['policy']): LivesPolicy {
  return name === 'unlimited' ? unlimitedPolicy : heartsPolicy
}

// --------------------------------------------------------------------------------------------- xp
export function xpFor(kind: SessionKind, perfect: boolean, cfg: AppConfig): { base: number; bonus: number; total: number } {
  const base = cfg.xp.base[kind]
  const bonus = perfect ? cfg.xp.perfectBonus : 0
  return { base, bonus, total: base + bonus }
}

export function dailyGoalStatus(xp: number, goal: number): { xp: number; goal: number; met: boolean } {
  return { xp, goal, met: xp >= goal }
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

export function rolloverCohort(
  members: readonly CohortMember[],
  tier: LeagueTier,
  cfg: AppConfig,
): { userId: string; rank: number; outcome: LeagueOutcome; nextTier: LeagueTier }[] {
  const sorted = [...members].sort((a, b) => b.weeklyXp - a.weeklyXp || a.userId.localeCompare(b.userId))
  const n = sorted.length
  const ti = LEAGUE_TIERS.indexOf(tier)
  const promote = ti === LEAGUE_TIERS.length - 1 ? 0 : Math.min(cfg.leagues.promote, Math.ceil(n / 4))
  const demote = ti === 0 ? 0 : Math.min(cfg.leagues.demote, Math.floor(n / 5))
  return sorted.map((m, i) => {
    const outcome: LeagueOutcome = i < promote ? 'promote' : i >= n - demote ? 'demote' : 'stay'
    const nextTier = LEAGUE_TIERS[ti + (outcome === 'promote' ? 1 : outcome === 'demote' ? -1 : 0)]!
    return { userId: m.userId, rank: i + 1, outcome, nextTier }
  })
}
