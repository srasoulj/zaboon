import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { DEFAULT_APP_CONFIG as cfg } from '@zaboon/contracts'
import {
  QUEST_TEMPLATES,
  dateInZone,
  leagueWeek,
  nextLocalMidnight,
  purchase,
  shopItems,
  tierAfter,
  unavailable,
  weekOf,
  type ShopState,
} from './index'

const shop = (over: Partial<ShopState> = {}): ShopState => ({
  coins: 500,
  streak: { current: 3, longest: 3, lastActiveDate: '2026-09-25', freezes: 0 },
  lives: { policy: 'hearts', count: 2, updatedAt: '2026-09-25T11:00:00Z' },
  purchases: [],
  ...over,
})
const noon = new Date('2026-09-25T12:00:00Z')

describe('league weeks', () => {
  it('start on a Monday 00:00 UTC and last exactly 7 days, for any instant', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        (d) => {
          const w = leagueWeek(d)
          const start = new Date(w.startsAt)
          expect(start.getUTCDay()).toBe(1)
          expect(w.startsAt.endsWith('T00:00:00.000Z')).toBe(true)
          expect(Date.parse(w.endsAt) - start.getTime()).toBe(7 * 86_400_000)
          expect(start.getTime()).toBeLessThanOrEqual(d.getTime())
          expect(d.getTime()).toBeLessThan(Date.parse(w.endsAt))
        },
      ),
    )
  })
  it('weekOf normalizes a stored startsAt', () => {
    expect(weekOf('2026-09-21T00:00:00+00:00')).toEqual({
      startsAt: '2026-09-21T00:00:00.000Z',
      endsAt: '2026-09-28T00:00:00.000Z',
    })
  })
})

describe('tierAfter', () => {
  it('moves one tier and stops at the ends', () => {
    expect(tierAfter('mes', 'promote')).toBe('noqreh')
    expect(tierAfter('tala', 'demote')).toBe('noqreh')
    expect(tierAfter('tala', 'stay')).toBe('tala')
    expect(tierAfter('almas', 'promote')).toBe('almas')
    expect(tierAfter('mes', 'demote')).toBe('mes')
  })
})

describe('nextLocalMidnight', () => {
  it('is the next local midnight in the learner timezone', () => {
    expect(nextLocalMidnight(noon, 'UTC')).toBe('2026-09-26T00:00:00.000Z')
    expect(nextLocalMidnight(noon, 'America/Los_Angeles')).toBe('2026-09-26T07:00:00.000Z')
    expect(nextLocalMidnight(noon, 'Asia/Tehran')).toBe('2026-09-25T20:30:00.000Z')
    // 23:59:59.999 local is one millisecond before the reset.
    expect(nextLocalMidnight(new Date('2026-09-26T06:59:59.999Z'), 'America/Los_Angeles')).toBe(
      '2026-09-26T07:00:00.000Z',
    )
  })
  it('handles DST days (23 and 25 hours) and a midnight that does not exist', () => {
    // Berlin springs forward on 2026-03-29 (a 23-hour day) and falls back on 2026-10-25.
    expect(nextLocalMidnight(new Date('2026-03-29T01:00:00Z'), 'Europe/Berlin')).toBe(
      '2026-03-29T22:00:00.000Z',
    )
    expect(nextLocalMidnight(new Date('2026-10-25T01:00:00Z'), 'Europe/Berlin')).toBe(
      '2026-10-25T23:00:00.000Z',
    )
    // Santiago skips 00:00 on 2026-09-06: the day starts at 01:00 local (04:00 UTC).
    expect(nextLocalMidnight(new Date('2026-09-05T12:00:00Z'), 'America/Santiago')).toBe(
      '2026-09-06T04:00:00.000Z',
    )
  })
  it('is always in the future and starts the next local date', () => {
    const zones = ['UTC', 'Asia/Tehran', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata']
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2035-01-01'), noInvalidDate: true }),
        fc.constantFrom(...zones),
        (d, tz) => {
          const r = Date.parse(nextLocalMidnight(d, tz))
          expect(r).toBeGreaterThan(d.getTime())
          expect(dateInZone(new Date(r), tz) > dateInZone(d, tz)).toBe(true)
          expect(dateInZone(new Date(r - 1), tz)).toBe(dateInZone(d, tz))
        },
      ),
    )
  })
})

describe('quest templates', () => {
  it('use quest_defs ids (^[a-z0-9_]{1,40}$), unique', () => {
    for (const t of QUEST_TEMPLATES) expect(t.id).toMatch(/^[a-z0-9_]{1,40}$/)
    expect(new Set(QUEST_TEMPLATES.map((t) => t.id)).size).toBe(QUEST_TEMPLATES.length)
  })
})

describe('shop', () => {
  it('unavailable agrees with purchase refusals and shopItems', () => {
    const states = [
      shop(),
      shop({ coins: 10 }),
      shop({ streak: { current: 0, longest: 0, lastActiveDate: null, freezes: 2 } }),
      shop({ lives: { policy: 'unlimited', count: 5, updatedAt: '2026-09-25T11:00:00Z' } }),
      shop({ lives: { policy: 'hearts', count: 5, updatedAt: '2026-09-25T11:00:00Z' } }),
    ]
    for (const s of states) {
      const items = shopItems(s, noon, cfg)
      for (const item of items) {
        expect(item.unavailable).toBe(unavailable(item.id, s, noon, cfg))
        const r = purchase(s, { item: item.id, purchaseId: crypto.randomUUID() }, noon, cfg)
        if (item.unavailable === null) expect(r.ok).toBe(true)
        else expect(r).toEqual({ ok: false, refusal: item.unavailable })
      }
    }
  })
  it('a purchase never makes coins negative', () => {
    fc.assert(
      fc.property(
        fc.nat(1000),
        fc.constantFrom('streak_freeze' as const, 'heart_refill' as const),
        (coins, item) => {
          const r = purchase(shop({ coins }), { item, purchaseId: 'p' }, noon, cfg)
          if (r.ok) expect(r.state.coins).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })
})
