/**
 * Oracle runner for @zaboon/game-rules: executes the read-only YAML tables in this folder against the
 * package's public API. Case counts are always checked; the cases run once IMPLEMENTATION is 'real'.
 *
 * Where an oracle pins behaviour that the API leaves to its caller (the wrong-attempt event store,
 * the practice exemption, commit reconciliation, per-day XP totals, stamping tzChangedAt), a few
 * lines of glue below play that caller. Every number still comes from the package.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg, LivesState, StreakState } from '@zaboon/contracts'
import type { LeagueTier, SessionKind, StreakView } from '@zaboon/contracts'
import {
  IMPLEMENTATION,
  acceptTzChange,
  applyActivity,
  dailyGoalStatus,
  dateInZone,
  livesPolicy,
  localDateFor,
  placeInCohort,
  rolloverCohort,
  streakView,
  xpFor,
} from '../src/index'
import type { CohortMember, LeagueOutcome, OpenCohort } from '../src/index'

// ------------------------------------------------------------------------------------ case shapes
interface Case<R extends string, I, E> {
  id: string
  rule: R
  note: string
  input: I
  expected: E
}

type LocalDateCase =
  | Case<
      'localDate',
      { tz: string; startedAt: string; completedAt: string; now: string },
      { clampedAt: string; localDate: string }
    >
  | Case<
      'tzChange',
      { profileTz: string; tzChangedAt: string | null; requestedTz: string; now: string },
      { tz: string; tzChangedAt: string | null; changed: boolean }
    >

interface StreakStep {
  state: StreakState
  frozenDates: string[]
  freezeGranted: boolean
}
type StreakCase =
  | Case<'applyActivity', { initial: StreakState; events: string[] }, { steps: StreakStep[]; final: StreakState }>
  | Case<'streakView', { state: StreakState; today: string }, StreakView>

type HeartsOp =
  | { op: 'view'; at: string }
  | { op: 'mistake'; at: string; sessionId: string; kind: SessionKind; attemptSeq: number }
  | { op: 'commit'; at: string; sessionId: string; kind: SessionKind; wrongAttempts: number }
type HeartsCase = Case<
  'hearts',
  { initial: LivesState; ops: HeartsOp[] },
  { steps: Record<string, string | number | boolean | null>[]; final: LivesState }
>

interface GoalStep {
  sessionXp: number
  dayXp: number
  met: boolean
  justMet: boolean
}
type XpCase =
  | Case<
      'sessionXp',
      { kind: SessionKind; wrongAttempts: number },
      { base: number; bonus: number; total: number; perfect: boolean }
    >
  | Case<
      'dailyGoal',
      { goal: number; sessions: { kind: SessionKind; wrongAttempts: number; localDate: string }[] },
      { steps: GoalStep[]; totals: Record<string, number> }
    >

interface RolloverExpected {
  promoteCount: number
  demoteCount: number
  promotedTo: LeagueTier | null
  demotedTo: LeagueTier | null
  ranking: string[]
  promoted: string[]
  demoted: string[]
}
type LeaguesCase =
  | Case<'placement', { cohorts: OpenCohort[] }, { cohortId: string | null; newCohort: boolean }>
  | Case<'rollover', { tier: LeagueTier; members: CohortMember[] }, RolloverExpected>

// ---------------------------------------------------------------------------------------- helpers
function loadCases<C>(url: URL): C[] {
  const data: unknown = parse(readFileSync(url, 'utf8'))
  if (!Array.isArray(data)) throw new Error(`${url.pathname}: expected a YAML list of cases`)
  return data as C[]
}

function unknownRule(c: never): never {
  throw new Error(`unknown oracle rule in ${JSON.stringify(c)}`)
}

/** Timestamps compare as instants, whatever offset they were written with. */
function instant(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`not a timestamp: ${iso}`)
  return ms
}

const TIMESTAMP_FIELDS = new Set(['updatedAt', 'nextRegenAt'])
function withInstants(o: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o).map(([k, v]: [string, unknown]) => [
      k,
      TIMESTAMP_FIELDS.has(k) && (typeof v === 'string' || v === null) ? instant(v) : v,
    ]),
  )
}

/** The fields of `actual` that `expected` pins, so toEqual checks exactly those. */
function pinned(actual: object, expected: object): Record<string, unknown> {
  const got = new Map<string, unknown>(Object.entries(actual))
  return Object.fromEntries(Object.keys(expected).map((k) => [k, got.get(k)]))
}

const stateOf = ({ current, longest, lastActiveDate, freezes }: StreakState): StreakState => ({
  current,
  longest,
  lastActiveDate,
  freezes,
})

// ---------------------------------------------------------------------------------------- runners
function runLocalDate(c: LocalDateCase): void {
  switch (c.rule) {
    case 'localDate': {
      const { tz, startedAt, completedAt, now } = c.input
      const localDate = localDateFor({
        completedAt: new Date(completedAt),
        startedAt: new Date(startedAt),
        now: new Date(now),
        tz,
      })
      expect({ localDate }).toEqual({ localDate: c.expected.localDate })
      // The API does not expose the clamped instant; check that clampedAt falls on that date.
      expect(dateInZone(new Date(c.expected.clampedAt), tz)).toBe(c.expected.localDate)
      return
    }
    case 'tzChange': {
      const { profileTz, tzChangedAt, requestedTz, now } = c.input
      const at = new Date(now)
      const current = { tz: profileTz, tzChangedAt: tzChangedAt === null ? null : new Date(tzChangedAt) }
      const r = acceptTzChange(current, requestedTz, at, cfg)
      // The caller stamps tzChangedAt = now when the change is accepted.
      const stamped = r.changed ? at.getTime() : instant(tzChangedAt)
      expect({ tz: r.tz, tzChangedAt: stamped, changed: r.changed }).toEqual({
        ...c.expected,
        tzChangedAt: instant(c.expected.tzChangedAt),
      })
      return
    }
    default:
      return unknownRule(c)
  }
}

function runStreak(c: StreakCase): void {
  switch (c.rule) {
    case 'applyActivity': {
      let state = StreakState.parse(c.input.initial)
      const steps = c.input.events.map((date) => {
        const r = applyActivity(state, date, cfg)
        state = r.state
        return { state: stateOf(r.state), frozenDates: r.frozenDates, freezeGranted: r.freezeGranted }
      })
      expect(steps).toEqual(c.expected.steps)
      expect(stateOf(state)).toEqual(c.expected.final)
      return
    }
    case 'streakView': {
      const state = StreakState.parse(c.input.state)
      const before = structuredClone(state)
      expect(pinned(streakView(state, c.input.today), c.expected)).toEqual(c.expected)
      expect(state).toEqual(before) // reads never write
      return
    }
    default:
      return unknownRule(c)
  }
}

function runHearts(c: HeartsCase): void {
  let state = LivesState.parse(c.input.initial)
  const policy = livesPolicy(state.policy)
  // Caller glue: wrong-attempt events are idempotent on (sessionId, attemptSeq).
  const recorded = new Map<string, Set<number>>()
  const steps = c.input.ops.map((op): Record<string, unknown> => {
    const at = new Date(op.at)
    switch (op.op) {
      case 'view': {
        const v = policy.view(state, at, cfg)
        return { count: v.count, nextRegenAt: v.nextRegenAt }
      }
      case 'mistake': {
        const seqs = recorded.get(op.sessionId) ?? new Set<number>()
        recorded.set(op.sessionId, seqs)
        const duplicate = seqs.has(op.attemptSeq)
        seqs.add(op.attemptSeq)
        // Caller glue: practice sessions never lose hearts.
        if (!duplicate && op.kind !== 'practice') state = policy.loseOne(state, at, cfg)
        return { duplicate, count: state.count, updatedAt: state.updatedAt }
      }
      case 'commit': {
        // Caller glue: charge graded wrongs whose events never arrived; practice earns a heart.
        const extra = Math.max(0, op.wrongAttempts - (recorded.get(op.sessionId)?.size ?? 0))
        if (op.kind === 'practice') state = policy.reward(state, cfg.hearts.practiceReward, at, cfg)
        else for (let i = 0; i < extra; i++) state = policy.loseOne(state, at, cfg)
        return { extra, count: state.count, updatedAt: state.updatedAt }
      }
      default:
        return unknownRule(op)
    }
  })
  expect(steps.map(withInstants)).toEqual(c.expected.steps.map(withInstants))
  expect(withInstants(pinned(state, c.expected.final))).toEqual(withInstants(c.expected.final))
}

function runXp(c: XpCase): void {
  switch (c.rule) {
    case 'sessionXp': {
      const perfect = c.input.wrongAttempts === 0 // the API takes the flag; perfect = no wrong attempts
      const { base, bonus, total } = xpFor(c.input.kind, perfect, cfg)
      expect({ base, bonus, total, perfect }).toEqual(c.expected)
      return
    }
    case 'dailyGoal': {
      // Caller glue: each session adds its XP to its own local date.
      const totals: Record<string, number> = {}
      const steps = c.input.sessions.map((s) => {
        const sessionXp = xpFor(s.kind, s.wrongAttempts === 0, cfg).total
        const before = dailyGoalStatus(totals[s.localDate] ?? 0, c.input.goal)
        const after = dailyGoalStatus(before.xp + sessionXp, c.input.goal)
        totals[s.localDate] = after.xp
        return { sessionXp, dayXp: after.xp, met: after.met, justMet: after.met && !before.met }
      })
      expect(steps).toEqual(c.expected.steps)
      expect(totals).toEqual(c.expected.totals)
      return
    }
    default:
      return unknownRule(c)
  }
}

function runLeagues(c: LeaguesCase): void {
  switch (c.rule) {
    case 'placement': {
      const cohortId = placeInCohort(c.input.cohorts, cfg)
      expect({ cohortId, newCohort: cohortId === null }).toEqual(c.expected)
      return
    }
    case 'rollover': {
      const out = [...rolloverCohort(c.input.members, c.input.tier, cfg)].sort((a, b) => a.rank - b.rank)
      expect(out.map((r) => r.rank)).toEqual(c.input.members.map((_, i) => i + 1))
      const who = (o: LeagueOutcome) => out.filter((r) => r.outcome === o)
      const tierAfter = (o: LeagueOutcome): LeagueTier | null => {
        const tiers = [...new Set(who(o).map((r) => r.nextTier))]
        expect(tiers.length).toBeLessThanOrEqual(1)
        return tiers[0] ?? null
      }
      expect(who('stay').every((r) => r.nextTier === c.input.tier)).toBe(true)
      const got: RolloverExpected = {
        promoteCount: who('promote').length,
        demoteCount: who('demote').length,
        promotedTo: tierAfter('promote'),
        demotedTo: tierAfter('demote'),
        ranking: out.map((r) => r.userId),
        promoted: who('promote').map((r) => r.userId),
        demoted: who('demote').map((r) => r.userId),
      }
      expect(got).toEqual(c.expected)
      return
    }
    default:
      return unknownRule(c)
  }
}

// ------------------------------------------------------------------------------------------ suites
function oracle<C extends { id: string }>(url: URL, count: number, run: (c: C) => void): void {
  const cases = loadCases<C>(url)
  describe(`oracles/${url.pathname.split('/').pop() ?? ''}`, () => {
    it(`has ${count} cases`, () => {
      expect(cases).toHaveLength(count)
    })
    describe.runIf(IMPLEMENTATION === 'real')('cases', () => {
      it.each(cases)('$id', run)
    })
  })
}

oracle<LocalDateCase>(new URL('./local-date.yaml', import.meta.url), 35, runLocalDate)
oracle<StreakCase>(new URL('./streak.yaml', import.meta.url), 52, runStreak)
oracle<HeartsCase>(new URL('./hearts.yaml', import.meta.url), 32, runHearts)
oracle<XpCase>(new URL('./xp.yaml', import.meta.url), 22, runXp)
oracle<LeaguesCase>(new URL('./leagues.yaml', import.meta.url), 28, runLeagues)
