/**
 * Oracle runner for the P2 engagement rules (engagement.yaml; read-only like the YAML). The case
 * count is always checked; the cases run once ENGAGEMENT_IMPLEMENTATION is 'real' (ws-engagement).
 * The runner calls exactly the API documented in the YAML header (src/engagement.ts); the only
 * caller glue is replaying the shop ops in order.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG as cfg, LivesState, StreakState } from '@zaboon/contracts'
import type { QuestMetric, SessionKind, ShopItemId } from '@zaboon/contracts'
import {
  ENGAGEMENT_IMPLEMENTATION,
  applyCoinGrants,
  applyQuestProgress,
  leagueGrant,
  leagueRewardCoins,
  leagueWeek,
  leagueXpStep,
  purchase,
  rolloverPlan,
  shopItems,
} from '../src/index'
import type { CoinGrant, LeagueWeekBounds, QuestRow, ShopState, StoredWeek } from '../src/index'

// ------------------------------------------------------------------------------------ case shapes
interface Case<R extends string, I, E> {
  id: string
  rule: R
  note: string
  input: I
  expected: E
}

interface ShopStateYaml {
  coins: number
  streak: StreakState
  lives: LivesState
  purchases: { purchaseId: string; item: ShopItemId }[]
}
type ShopStep =
  | { ok: true; replayed: boolean; charged: number; coins: number; freezes: number; hearts: number }
  | { ok: false; refusal: string }

type EngagementCase =
  | Case<'leagueWeek', { now: string }, LeagueWeekBounds>
  | Case<
      'rolloverPlan',
      { weeks: StoredWeek[]; now: string },
      { close: string[]; current: LeagueWeekBounds }
    >
  | Case<
      'leagueXp',
      { member: { weeklyXp: number } | null; linked: boolean; sessionXp: number; flagged: boolean },
      { join: boolean; weeklyXp: number | null }
    >
  | Case<
      'leagueReward',
      { week: LeagueWeekBounds; rank: number },
      { coins: number; grant: CoinGrant | null }
    >
  | Case<
      'coinGrants',
      { wallet: { coins: number; ledger: { reason: string; ref: string }[] }; grants: CoinGrant[] },
      { coins: number; applied: CoinGrant[]; skipped: CoinGrant[] }
    >
  | Case<
      'quests',
      {
        date: string
        defs: { id: string; metric: QuestMetric; target: number }[]
        rows: QuestRow[]
        session: { kind: SessionKind; xp: number; perfect: boolean; flagged: boolean }
      },
      {
        quests: (QuestRow & { completed: boolean; justCompleted: boolean })[]
        grants: CoinGrant[]
      }
    >
  | Case<
      'shop',
      { initial: ShopStateYaml; ops: { at: string; item: ShopItemId; purchaseId: string }[] },
      {
        steps: ShopStep[]
        final: {
          coins: number
          freezes: number
          lives: LivesState
          purchases: { purchaseId: string; item: ShopItemId }[]
        }
      }
    >
  | Case<'shopItems', { state: ShopStateYaml; at: string }, { items: unknown[] }>

// ---------------------------------------------------------------------------------------- helpers
function loadCases<C>(url: URL): C[] {
  const data: unknown = parse(readFileSync(url, 'utf8'))
  if (!Array.isArray(data)) throw new Error(`${url.pathname}: expected a YAML list of cases`)
  return data as C[]
}

function unknownRule(c: never): never {
  throw new Error(`unknown oracle rule in ${JSON.stringify(c)}`)
}

/** Timestamps compare as instants, whatever offset or precision they were written with. */
function instant(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`not a timestamp: ${iso}`)
  return ms
}
const weekInstants = (w: LeagueWeekBounds) => ({
  startsAt: instant(w.startsAt),
  endsAt: instant(w.endsAt),
})
const livesInstants = (l: LivesState) => ({ ...l, updatedAt: instant(l.updatedAt) })

function shopState(s: ShopStateYaml): ShopState {
  return {
    coins: s.coins,
    streak: StreakState.parse(s.streak),
    lives: LivesState.parse(s.lives),
    purchases: s.purchases,
  }
}

// ----------------------------------------------------------------------------------------- runner
function run(c: EngagementCase): void {
  switch (c.rule) {
    case 'leagueWeek':
      expect(weekInstants(leagueWeek(new Date(c.input.now)))).toEqual(weekInstants(c.expected))
      return
    case 'rolloverPlan': {
      const got = rolloverPlan(c.input.weeks, new Date(c.input.now))
      expect(got.close.map(instant)).toEqual(c.expected.close.map(instant))
      expect(weekInstants(got.current)).toEqual(weekInstants(c.expected.current))
      return
    }
    case 'leagueXp':
      expect(leagueXpStep(c.input)).toEqual(c.expected)
      return
    case 'leagueReward':
      expect({
        coins: leagueRewardCoins(c.input.rank, cfg),
        grant: leagueGrant(c.input.week, c.input.rank, cfg),
      }).toEqual(c.expected)
      return
    case 'coinGrants':
      expect(applyCoinGrants(c.input.wallet, c.input.grants)).toEqual(c.expected)
      return
    case 'quests': {
      const got = applyQuestProgress({ ...c.input, cfg })
      expect(got).toEqual(c.expected)
      return
    }
    case 'shop': {
      let state = shopState(c.input.initial)
      const steps = c.input.ops.map((op): ShopStep => {
        const r = purchase(state, { item: op.item, purchaseId: op.purchaseId }, new Date(op.at), cfg)
        if (!r.ok) return { ok: false, refusal: r.refusal }
        state = r.state
        return {
          ok: true,
          replayed: r.replayed,
          charged: r.charged,
          coins: state.coins,
          freezes: state.streak.freezes,
          hearts: state.lives.count,
        }
      })
      expect(steps).toEqual(c.expected.steps)
      const { lives, ...rest } = c.expected.final
      expect({
        coins: state.coins,
        freezes: state.streak.freezes,
        purchases: state.purchases,
      }).toEqual(rest)
      expect(livesInstants(state.lives)).toEqual(livesInstants(LivesState.parse(lives)))
      return
    }
    case 'shopItems':
      expect(shopItems(shopState(c.input.state), new Date(c.input.at), cfg)).toEqual(
        c.expected.items,
      )
      return
    default:
      return unknownRule(c)
  }
}

// ------------------------------------------------------------------------------------------ suite
const cases = loadCases<EngagementCase>(new URL('./engagement.yaml', import.meta.url))

describe('oracles/engagement.yaml', () => {
  it('has 65 cases with unique ids', () => {
    expect(cases).toHaveLength(65)
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length)
  })
  describe.runIf(ENGAGEMENT_IMPLEMENTATION === 'real')('cases', () => {
    it.each(cases)('$id', run)
  })
})
