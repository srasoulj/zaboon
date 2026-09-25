/**
 * Tests for the helpers that replace the oracle runner's caller glue: the oracle YAML cases are fed
 * through the exported helpers (no rule logic here) and must give the same results. Plus property
 * tests for streak invariants, energy and quests.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_CONFIG as cfg,
  LivesState,
  LivesView,
  StreakState,
  StreakView,
} from '@zaboon/contracts'
import type { SessionKind } from '@zaboon/contracts'
import {
  IMPLEMENTATION,
  QUEST_TEMPLATES,
  acceptTzChange,
  addDays,
  applyActivity,
  applyMistakeEvent,
  clampActivityTime,
  dailyGoalStep,
  dailyQuests,
  energyPolicy,
  extraHeartsToCharge,
  heartsPolicy,
  initialLives,
  initialStreak,
  livesPolicy,
  localDateFor,
  questIncrement,
  sessionXp,
  settleCommit,
  streakView,
  wrongEventKey,
} from './index'

const load = <T>(name: string): T[] =>
  parse(readFileSync(new URL(`../oracles/${name}`, import.meta.url), 'utf8')) as T[]
const ms = (iso: string | null) => (iso === null ? null : Date.parse(iso))

interface LocalDateCase {
  id: string
  rule: 'localDate' | 'tzChange'
  input: Record<string, string | null>
  expected: Record<string, string | boolean | null>
}

interface HeartsOp {
  op: 'view' | 'mistake' | 'commit'
  at: string
  sessionId: string
  kind: SessionKind
  attemptSeq: number
  wrongAttempts: number
}
interface HeartsCase {
  id: string
  input: { initial: LivesState; ops: HeartsOp[] }
  expected: {
    steps: Record<string, string | number | boolean | null>[]
    final: Record<string, string | number>
  }
}

interface XpCase {
  id: string
  rule: 'sessionXp' | 'dailyGoal'
  input: {
    kind: SessionKind
    wrongAttempts: number
    goal: number
    sessions: { kind: SessionKind; wrongAttempts: number; localDate: string }[]
  }
  expected: { steps: unknown[]; totals: Record<string, number> } & Record<string, unknown>
}

const TIMESTAMPS = new Set(['updatedAt', 'nextRegenAt'])
const instants = (o: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, TIMESTAMPS.has(k) ? ms(v as string | null) : v]),
  )

describe('game-rules helpers', () => {
  it('is the real implementation', () => {
    expect(IMPLEMENTATION).toBe('real')
  })

  describe('oracles/local-date.yaml through clampActivityTime + acceptTzChange', () => {
    it.each(load<LocalDateCase>('local-date.yaml'))('$id', (c) => {
      const i = c.input
      if (c.rule === 'localDate') {
        const input = {
          completedAt: new Date(i.completedAt!),
          startedAt: new Date(i.startedAt!),
          now: new Date(i.now!),
          tz: i.tz!,
        }
        expect(clampActivityTime(input, input.now).getTime()).toBe(
          ms(c.expected.clampedAt as string),
        )
        expect(localDateFor(input)).toBe(c.expected.localDate)
      } else {
        const r = acceptTzChange(
          { tz: i.profileTz!, tzChangedAt: i.tzChangedAt ? new Date(i.tzChangedAt) : null },
          i.requestedTz!,
          new Date(i.now!),
          cfg,
        )
        expect({
          tz: r.tz,
          changed: r.changed,
          tzChangedAt: r.tzChangedAt?.getTime() ?? null,
        }).toEqual({
          tz: c.expected.tz,
          changed: c.expected.changed,
          tzChangedAt: ms(c.expected.tzChangedAt as string | null),
        })
      }
    })
  })

  describe('oracles/hearts.yaml through applyMistakeEvent + settleCommit', () => {
    it.each(load<HeartsCase>('hearts.yaml'))('$id', (c) => {
      let state = LivesState.parse(c.input.initial)
      const recorded = new Set<string>()
      const steps = c.input.ops.map((op) => {
        const now = new Date(op.at)
        if (op.op === 'view') {
          const v = LivesView.parse(livesPolicy(state.policy).view(state, now, cfg))
          return { count: v.count, nextRegenAt: v.nextRegenAt }
        }
        if (op.op === 'mistake') {
          const r = applyMistakeEvent({
            state,
            kind: op.kind,
            sessionId: op.sessionId,
            attemptSeq: op.attemptSeq,
            recorded,
            now,
            cfg,
          })
          if (!r.duplicate) recorded.add(r.key)
          state = r.state
          return { duplicate: r.duplicate, count: state.count, updatedAt: state.updatedAt }
        }
        const events = [...recorded].filter((k) => k.startsWith(`${op.sessionId}:`)).length
        const r = settleCommit({
          state,
          kind: op.kind,
          serverWrong: op.wrongAttempts,
          recordedEvents: events,
          now,
          cfg,
        })
        state = r.state
        return { extra: r.extra, count: state.count, updatedAt: state.updatedAt }
      })
      expect(steps.map(instants)).toEqual(c.expected.steps.map(instants))
      const pinned = Object.fromEntries(
        Object.keys(c.expected.final).map((k) => [k, (state as Record<string, unknown>)[k]]),
      )
      expect(instants(pinned)).toEqual(instants(c.expected.final))
    })
  })

  describe('oracles/xp.yaml through sessionXp + dailyGoalStep', () => {
    it.each(load<XpCase>('xp.yaml'))('$id', (c) => {
      if (c.rule === 'sessionXp') {
        expect(sessionXp(c.input.kind, c.input.wrongAttempts, cfg)).toEqual(c.expected)
        return
      }
      const totals: Record<string, number> = {}
      const steps = c.input.sessions.map((s) => {
        const r = dailyGoalStep(
          totals[s.localDate] ?? 0,
          sessionXp(s.kind, s.wrongAttempts, cfg).total,
          c.input.goal,
        )
        totals[s.localDate] = r.dayXp
        return { sessionXp: r.sessionXp, dayXp: r.dayXp, met: r.met, justMet: r.justMet }
      })
      expect(steps).toEqual(c.expected.steps)
      expect(totals).toEqual(c.expected.totals)
    })
  })

  it('wrong-event keys are per (sessionId, attemptSeq)', () => {
    expect(wrongEventKey('s1', 1)).not.toBe(wrongEventKey('s2', 1))
    expect(wrongEventKey('s1', 1)).not.toBe(wrongEventKey('s1', 2))
    expect(extraHeartsToCharge(2, 5)).toBe(0)
    expect(extraHeartsToCharge(5, 2)).toBe(3)
  })

  it('a practice commit at 0 hearts ends at practiceReward', () => {
    const now = new Date('2026-09-25T12:00:00Z')
    const r = settleCommit({
      state: { policy: 'hearts', count: 0, updatedAt: now.toISOString() },
      kind: 'practice',
      serverWrong: 3,
      recordedEvents: 0,
      now,
      cfg,
    })
    expect(r).toMatchObject({ extra: 3, state: { count: cfg.hearts.practiceReward } })
  })
})

// ------------------------------------------------------------------------------------ properties
const date = fc.integer({ min: 0, max: 3650 }).map((d) => addDays('2024-01-01', d))

describe('streak invariants (property)', () => {
  const steps = fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 60 })

  it('current <= longest, freezes <= max, lastActiveDate never moves back', () => {
    fc.assert(
      fc.property(date, steps, (start, gaps) => {
        let s = StreakState.parse(initialStreak(cfg))
        let d = start
        for (const g of gaps) {
          d = addDays(d, g)
          const before = s
          const r = applyActivity(s, d, cfg)
          s = StreakState.parse(r.state)
          expect(s.current).toBeLessThanOrEqual(s.longest)
          expect(s.longest).toBeGreaterThanOrEqual(before.longest)
          expect(s.freezes).toBeLessThanOrEqual(cfg.streak.maxFreezes)
          expect(s.freezes).toBeGreaterThanOrEqual(0)
          expect(s.current).toBeGreaterThanOrEqual(1)
          if (before.lastActiveDate !== null)
            expect(s.lastActiveDate! >= before.lastActiveDate).toBe(true)
          expect(r.frozenDates.length).toBeLessThanOrEqual(before.freezes)
          if (r.freezeGranted) expect(s.current % cfg.streak.freezeEveryDays).toBe(0)
          expect(r.extendedToday).toBe(g > 0 || before.lastActiveDate === null)
        }
      }),
    )
  })

  it('applying the same date twice is a no-op; the view never mutates and always parses', () => {
    fc.assert(
      fc.property(date, steps, fc.integer({ min: -3, max: 10 }), (start, gaps, ahead) => {
        let s = applyActivity(initialStreak(cfg), start, cfg).state
        let d = start
        for (const g of gaps) s = applyActivity(s, (d = addDays(d, g)), cfg).state
        expect(applyActivity(s, d, cfg).state).toEqual(s)
        const frozen = structuredClone(s)
        const v = StreakView.parse(streakView(s, addDays(d, ahead)))
        expect(s).toEqual(frozen)
        expect(v.freezes).toBe(s.freezes)
        expect(v.current).toBeLessThanOrEqual(s.longest)
      }),
    )
  })
})

describe('hearts invariants (property)', () => {
  it('count stays in [0, max], views parse, reads never write', () => {
    const op = fc.record({
      kind: fc.constantFrom('lose', 'reward', 'view'),
      minutes: fc.integer({ min: -60, max: 600 }),
    })
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        let t = Date.parse('2026-09-25T00:00:00Z')
        let s = initialLives(new Date(t), cfg)
        for (const o of ops) {
          t += o.minutes * 60_000
          const now = new Date(t)
          if (o.kind === 'lose') s = heartsPolicy.loseOne(s, now, cfg)
          else if (o.kind === 'reward') s = heartsPolicy.reward(s, 1, now, cfg)
          else {
            const before = structuredClone(s)
            const v = LivesView.parse(heartsPolicy.view(s, now, cfg))
            expect(s).toEqual(before)
            expect(v.nextRegenAt === null).toBe(v.count === cfg.hearts.max)
          }
          expect(() => LivesState.parse(s)).not.toThrow()
          expect(s.count).toBeGreaterThanOrEqual(0)
          expect(s.count).toBeLessThanOrEqual(cfg.hearts.max)
        }
      }),
    )
  })
})

describe('energy policy (P2 experiment)', () => {
  const now = new Date('2026-09-25T12:00:00Z')
  const energy = energyPolicy({
    max: 20,
    regenMinutes: 30,
    costPerChallenge: 1,
    refundEvery: 5,
    refund: 1,
  })

  it('reserves at start and settles at commit', () => {
    const s0 = energy.initial(now)
    const { state: s1, reserved } = energy.reserve(s0, 12, now)
    expect(reserved).toBe(12)
    expect(energy.view(s1, now, cfg)).toMatchObject({ policy: 'energy', count: 8, max: 20 })
    // Quit after 7 challenges with one run of 5 correct: 5 unused come back, +1 refund.
    const s2 = energy.settle(s1, { reserved, answered: 7, correctRuns: [5, 2] }, now)
    expect(s2.count).toBe(14)
  })

  it('regenerates lazily and never exceeds max', () => {
    const { state } = energy.reserve(energy.initial(now), 30, now)
    expect(state.count).toBe(0)
    const later = new Date(now.getTime() + 95 * 60_000)
    expect(energy.view(state, later, cfg)).toMatchObject({ count: 3 })
    expect(energy.reward(state, 100, later, cfg).count).toBe(20)
    expect(energy.loseOne(energy.initial(now), now, cfg).count).toBe(19)
  })
})

describe('daily quests', () => {
  it('are deterministic per (user, date), distinct metrics, perDay long', () => {
    fc.assert(
      fc.property(fc.uuid(), date, (userId, d) => {
        const a = dailyQuests(userId, d, cfg)
        expect(a).toEqual(dailyQuests(userId, d, cfg))
        expect(a).toHaveLength(cfg.quests.perDay)
        expect(new Set(a.map((q) => q.metric)).size).toBe(a.length)
        for (const q of a) {
          expect(QUEST_TEMPLATES.some((t) => t.id === q.templateId)).toBe(true)
          expect(q.id).toBe(`${d}:${q.templateId}`)
        }
      }),
    )
  })

  it('vary across users and dates', () => {
    const sets = new Set<string>()
    for (let i = 0; i < 30; i++)
      sets.add(
        dailyQuests(`user-${i}`, '2026-09-25', cfg)
          .map((q) => q.templateId)
          .join(),
      )
    for (let i = 0; i < 30; i++)
      sets.add(
        dailyQuests('user-0', addDays('2026-09-25', i), cfg)
          .map((q) => q.templateId)
          .join(),
      )
    expect(sets.size).toBeGreaterThan(5)
  })

  it('count sessions per metric', () => {
    const lesson = { kind: 'lesson' as const, xp: 15, perfect: true }
    expect(questIncrement('xp', lesson)).toBe(15)
    expect(questIncrement('lessons', lesson)).toBe(1)
    expect(questIncrement('perfect_sessions', lesson)).toBe(1)
    expect(questIncrement('practice_sessions', lesson)).toBe(0)
    expect(questIncrement('letters_sessions', { kind: 'letters', xp: 10, perfect: false })).toBe(1)
  })
})
