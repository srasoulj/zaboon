import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_CONFIG as cfg,
  LivesView,
  QuestMetric,
  StreakState,
  StreakView,
} from '@zaboon/contracts'
import {
  ENGAGEMENT_IMPLEMENTATION,
  NotImplementedError,
  QUEST_TEMPLATES,
  applyActivity,
  applyCoinGrants,
  applyQuestProgress,
  dailyGoalStatus,
  heartsPolicy,
  initialLives,
  initialStreak,
  leagueGrant,
  leagueRewardCoins,
  leagueWeek,
  leagueXpStep,
  localDateFor,
  placeInCohort,
  purchase,
  questGrant,
  rolloverCohort,
  rolloverPlan,
  shopItems,
  streakView,
  xpFor,
} from './index'

const now = new Date('2026-09-25T12:00:00Z')

describe('@zaboon/game-rules contract', () => {
  it('local date clamps and converts to the session timezone', () => {
    const d = localDateFor({
      completedAt: new Date('2026-09-25T06:55:00Z'),
      startedAt: new Date('2026-09-25T06:50:00Z'),
      now,
      tz: 'America/Los_Angeles',
    })
    expect(d).toBe('2026-09-24')
  })
  it('first activity starts a streak; next day extends it', () => {
    const s0 = StreakState.parse(initialStreak(cfg))
    const r1 = applyActivity(s0, '2026-09-24', cfg)
    expect(r1.state.current).toBe(1)
    const r2 = applyActivity(r1.state, '2026-09-25', cfg)
    expect(r2.state.current).toBe(2)
    expect(StreakView.parse(streakView(r2.state, '2026-09-25')).status).toBe('extended')
  })
  it('hearts: losing one decrements and views validate', () => {
    const l0 = initialLives(now, cfg)
    const l1 = heartsPolicy.loseOne(l0, now, cfg)
    const v = LivesView.parse(heartsPolicy.view(l1, now, cfg))
    expect(v.count).toBe(cfg.hearts.max - 1)
    expect(v.nextRegenAt).not.toBeNull()
  })
  it('xp and daily goal', () => {
    expect(xpFor('lesson', true, cfg)).toEqual({ base: 10, bonus: 5, total: 15 })
    expect(dailyGoalStatus(20, 20).met).toBe(true)
  })
  it('leagues: placement and rollover shapes', () => {
    expect(placeInCohort([], cfg)).toBeNull()
    expect(
      placeInCohort(
        [
          { id: 'a', size: 3, createdOrder: 1 },
          { id: 'b', size: 9, createdOrder: 2 },
        ],
        cfg,
      ),
    ).toBe('b')
    const out = rolloverCohort(
      [
        { userId: 'u1', weeklyXp: 10 },
        { userId: 'u2', weeklyXp: 50 },
      ],
      'tala',
      cfg,
    )
    expect(out[0]!.userId).toBe('u2')
    expect(out[0]!.rank).toBe(1)
  })
  it('quest templates count contract quest metrics', () => {
    for (const t of QUEST_TEMPLATES) {
      const metric: QuestMetric = t.metric
      expect(QuestMetric.options).toContain(metric)
    }
  })
  it('exports the P2 engagement API (oracles/engagement.yaml)', () => {
    for (const fn of [
      leagueWeek,
      rolloverPlan,
      leagueXpStep,
      leagueRewardCoins,
      leagueGrant,
      questGrant,
      applyCoinGrants,
      applyQuestProgress,
      purchase,
      shopItems,
    ])
      expect(typeof fn).toBe('function')
    expect(['stub', 'real']).toContain(ENGAGEMENT_IMPLEMENTATION)
  })
  it.runIf(ENGAGEMENT_IMPLEMENTATION === 'stub')('engagement stubs throw NotImplementedError', () => {
    expect(() => leagueWeek(now)).toThrow(NotImplementedError)
    expect(() => questGrant('2026-09-25', 'xp_20', cfg)).toThrow(NotImplementedError)
  })
})
