/** DOM tests for the P2 engagement UI: leaderboard, quests, shop, rail cards, hearts popover. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  HomeResponse,
  LeaderboardResponse,
  QuestDto,
  QuestsResponse,
  ShopResponse,
} from '@zaboon/contracts'
import { StatPill } from '@zaboon/ui'
import { ApiClientError } from '@/lib/api-client'
import { renderWithServices, testHome } from '../path/test-support'
import { heartsPopover } from './hearts-popover'
import { LeaderboardScreen } from './LeaderboardScreen'
import { QuestsScreen } from './QuestsScreen'
import { EngagementRail } from './Rail'
import { formatRemaining } from './shared'
import { ShopScreen } from './ShopScreen'

afterEach(() => {
  cleanup()
})

const ALL_ON = { leagues: true, quests: true, shop: true, practiceHub: true }

const QUESTS: QuestDto[] = [
  {
    id: 'xp_20',
    metric: 'xp',
    title: 'Earn 20 XP',
    target: 20,
    progress: 15,
    completed: false,
    reward: 10,
  },
  {
    id: 'lessons_1',
    metric: 'lessons',
    title: 'Complete a lesson',
    target: 1,
    progress: 1,
    completed: true,
    reward: 10,
  },
]

function home(over: Partial<HomeResponse> = {}, member = false): HomeResponse {
  const base = testHome()
  return {
    ...base,
    user: { ...base.user, isAnonymous: !member },
    lives: {
      policy: 'hearts',
      count: 3,
      max: 5,
      nextRegenAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    },
    ...over,
  }
}

const inAWeek = new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000 + 60_000).toISOString()

const BOARD: LeaderboardResponse = {
  tier: 'noqreh',
  week: { startsAt: '2026-09-21T00:00:00.000Z', endsAt: inAWeek },
  joined: true,
  members: [
    {
      rank: 1,
      displayName: 'Bita',
      username: 'bita',
      avatar: null,
      weeklyXp: 60,
      isMe: false,
      zone: 'promote',
    },
    {
      rank: 2,
      displayName: null,
      username: null,
      avatar: null,
      weeklyXp: 40,
      isMe: true,
      zone: 'stay',
    },
    {
      rank: 3,
      displayName: null,
      username: 'kian',
      avatar: null,
      weeklyXp: 5,
      isMe: false,
      zone: 'demote',
    },
  ],
  promoteCount: 1,
  demoteCount: 1,
  lastResult: {
    week: { startsAt: '2026-09-14T00:00:00.000Z', endsAt: '2026-09-21T00:00:00.000Z' },
    tier: 'mes',
    rank: 1,
    outcome: 'promote',
    newTier: 'noqreh',
    coins: 30,
  },
}

const SHOP: ShopResponse = {
  coins: 120,
  items: [
    { id: 'streak_freeze', price: 100, owned: 1, max: 2, unavailable: null },
    { id: 'heart_refill', price: 150, owned: null, max: null, unavailable: 'insufficient_coins' },
  ],
}

describe('formatRemaining', () => {
  it('formats days, hours and minutes', () => {
    expect(formatRemaining(2 * 86_400_000 + 5 * 3_600_000)).toBe('2d 5h')
    expect(formatRemaining(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m')
    expect(formatRemaining(12 * 60_000 + 5_000)).toBe('12m')
    expect(formatRemaining(30_000)).toBe('less than a minute')
  })
})

describe('LeaderboardScreen', () => {
  it('flag off: not available, and no leaderboard request', async () => {
    const { calls } = renderWithServices(<LeaderboardScreen />, {
      handlers: { home: () => home({}, true) },
    })
    expect(await screen.findByTestId('feature-off')).toHaveTextContent('Leaderboards')
    expect(calls.map((c) => c.name)).toEqual(['home'])
  })

  it('guests see "Create a profile to join leagues" and never call the leaderboard', async () => {
    const { calls } = renderWithServices(<LeaderboardScreen />, {
      handlers: { home: () => home({ flags: ALL_ON }) },
    })
    const card = await screen.findByTestId('leagues-guest')
    expect(
      within(card).getByRole('heading', { name: 'Create a profile to join leagues' }),
    ).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Create a profile' })).toHaveAttribute(
      'href',
      '/settings/account',
    )
    expect(calls.map((c) => c.name)).toEqual(['home'])
  })

  it('members see the tier banner, the cohort with zones and "you", the countdown and last week', async () => {
    renderWithServices(<LeaderboardScreen />, {
      handlers: { home: () => home({ flags: ALL_ON }, true), leaderboard: () => BOARD },
    })
    const banner = await screen.findByTestId('league-banner')
    expect(within(banner).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Noqreh League نقره',
    )
    const fa = banner.querySelector('[lang="fa"]')!
    expect(fa).toHaveAttribute('dir', 'rtl')
    expect(screen.getByTestId('league-countdown')).toHaveTextContent('Week ends in 2d 3h')
    expect(screen.getByTestId('league-last-result')).toHaveTextContent(
      'You finished #1 and moved up to the Noqreh League! +30 coins.',
    )
    const rows = screen.getAllByTestId('league-member')
    expect(rows.map((r) => [r.dataset.rank, r.dataset.zone, r.dataset.me])).toEqual([
      ['1', 'promote', 'false'],
      ['2', 'stay', 'true'],
      ['3', 'demote', 'false'],
    ])
    expect(rows[0]).toHaveTextContent('Bita')
    // Names are direction-isolated (a Persian or mixed name can't reorder the row).
    expect(within(rows[0]!).getByTestId('league-member-name').tagName).toBe('BDI')
    expect(rows[1]).toHaveTextContent('Learner (you)')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[2]).toHaveTextContent('kian')
    expect(within(rows[0]!).getByText('Promotion zone')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Demotion zone')).toBeInTheDocument()
    expect(screen.getByText('Top 1 move up · bottom 1 move down')).toBeInTheDocument()
  })

  it('before the first XP of the week: not joined', async () => {
    renderWithServices(<LeaderboardScreen />, {
      handlers: {
        home: () => home({ flags: ALL_ON }, true),
        leaderboard: () => ({
          ...BOARD,
          joined: false,
          members: [],
          lastResult: null,
          promoteCount: 0,
          demoteCount: 0,
        }),
      },
    })
    expect(await screen.findByTestId('league-not-joined')).toHaveTextContent(
      'Finish a lesson this week to join the Noqreh League.',
    )
    expect(screen.queryByTestId('league-last-result')).toBeNull()
  })
})

describe('QuestsScreen', () => {
  it('shows today’s quests with progress bars and the reset countdown', async () => {
    const q: QuestsResponse = {
      date: '2026-09-25',
      resetsAt: new Date(Date.now() + 5 * 3_600_000 + 30 * 60_000).toISOString(),
      quests: QUESTS,
    }
    renderWithServices(<QuestsScreen />, {
      handlers: { home: () => home({ flags: ALL_ON }), quests: () => q },
    })
    expect(await screen.findByRole('heading', { name: 'Today · 1 of 2 done' })).toBeInTheDocument()
    expect(screen.getByTestId('quests-reset')).toHaveTextContent('New quests in 5h 29m')
    const bar = screen.getByRole('progressbar', { name: 'Earn 20 XP' })
    expect(bar).toHaveAttribute('aria-valuenow', '15')
    expect(bar).toHaveAttribute('aria-valuemax', '20')
    const items = screen.getAllByTestId('quest')
    expect(items.map((i) => i.dataset.completed)).toEqual(['false', 'true'])
  })

  it('flag off: not available', async () => {
    const { calls } = renderWithServices(<QuestsScreen />, { handlers: { home: () => home() } })
    expect(await screen.findByTestId('feature-off')).toHaveTextContent('Quests')
    expect(calls.map((c) => c.name)).toEqual(['home'])
  })
})

describe('ShopScreen', () => {
  it('shows the balance, the items with price, owned/max and why one is unavailable', async () => {
    renderWithServices(<ShopScreen />, {
      handlers: { home: () => home({ flags: ALL_ON }), shop: () => SHOP },
    })
    expect(await screen.findByTestId('shop-coins')).toHaveTextContent('120')
    const [freeze, refill] = screen.getAllByTestId('shop-item')
    expect(freeze).toHaveTextContent('Streak freeze')
    expect(within(freeze!).getByTestId('shop-owned')).toHaveTextContent('1 / 2 equipped')
    expect(
      within(freeze!).getByRole('button', { name: /^buy streak freeze for 100 coins$/i }),
    ).not.toHaveAttribute('aria-disabled')
    const locked = within(refill!).getByRole('button', {
      name: /^buy heart refill for 150 coins$/i,
    })
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(within(refill!).getByTestId('shop-why')).toHaveTextContent('Not enough coins')
  })

  it('each tap sends a fresh purchaseId; a failed delivery is retried with the same id', async () => {
    const ids: string[] = []
    let fail = true
    renderWithServices(<ShopScreen />, {
      handlers: {
        home: () => home({ flags: ALL_ON }),
        shop: () => SHOP,
        purchase: (o) => {
          const body = (o as { body: { item: string; purchaseId: string } }).body
          ids.push(body.purchaseId)
          if (fail) {
            fail = false
            throw new ApiClientError('network', 0, 'offline')
          }
          return {
            purchaseId: body.purchaseId,
            item: 'streak_freeze',
            replayed: false,
            coins: 20,
            streak: { current: 1, status: 'extended', freezes: 2 },
            lives: { policy: 'hearts', count: 5, max: 5, nextRegenAt: null },
          }
        },
      },
    })
    const freeze = (await screen.findAllByTestId('shop-item'))[0]!
    fireEvent.click(
      within(freeze).getByRole('button', { name: /^buy streak freeze for 100 coins$/i }),
    )
    await waitFor(() =>
      expect(within(freeze).getByTestId('shop-status')).toHaveTextContent(/couldn't reach/),
    )
    fireEvent.click(within(freeze).getByRole('button', { name: /^retry: buy streak freeze/i }))
    await waitFor(() =>
      expect(within(freeze).getByTestId('shop-status')).toHaveTextContent(
        'Bought! You have 20 coins left.',
      ),
    )
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
    fireEvent.click(
      within(freeze).getByRole('button', { name: /^buy streak freeze for 100 coins$/i }),
    )
    await waitFor(() => expect(ids).toHaveLength(3))
    expect(ids[2]).not.toBe(ids[0])
    expect(ids[2]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('a refusal shows its reason and clears the id', async () => {
    const ids: string[] = []
    renderWithServices(<ShopScreen />, {
      handlers: {
        home: () => home({ flags: ALL_ON }),
        shop: () => SHOP,
        purchase: (o) => {
          ids.push((o as { body: { purchaseId: string } }).body.purchaseId)
          throw new ApiClientError('conflict', 409, 'refused', { reason: 'max_owned' })
        },
      },
    })
    const freeze = (await screen.findAllByTestId('shop-item'))[0]!
    fireEvent.click(
      within(freeze).getByRole('button', { name: /^buy streak freeze for 100 coins$/i }),
    )
    await waitFor(() =>
      expect(within(freeze).getByTestId('shop-status')).toHaveTextContent('You have the maximum'),
    )
    fireEvent.click(
      within(freeze).getByRole('button', { name: /^buy streak freeze for 100 coins$/i }),
    )
    await waitFor(() => expect(ids).toHaveLength(2))
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('EngagementRail', () => {
  it('renders nothing while every flag is off', () => {
    const { container } = renderWithServices(<EngagementRail home={home({}, true)} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('members: the league card and the daily-quests card', () => {
    renderWithServices(
      <EngagementRail
        home={home(
          {
            flags: ALL_ON,
            league: {
              tier: 'tala',
              joined: true,
              rank: 4,
              weeklyXp: 55,
              zone: 'promote',
              endsAt: inAWeek,
            },
            quests: QUESTS,
          },
          true,
        )}
      />,
    )
    const league = screen.getByTestId('rail-league')
    expect(league).toHaveTextContent('Talā League')
    expect(within(league).getByTestId('rail-league-rank')).toHaveTextContent(
      '#4 · 55 XP · Promotion zone',
    )
    expect(within(league).getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/leaderboard',
    )
    const quests = screen.getByTestId('rail-quests')
    expect(within(quests).getAllByTestId('quest')).toHaveLength(2)
    expect(screen.queryByTestId('rail-profile')).toBeNull()
  })

  it('guests: the "create a profile" card instead of the league', () => {
    renderWithServices(<EngagementRail home={home({ flags: { leagues: true } })} />)
    expect(screen.getByTestId('rail-profile')).toHaveTextContent('Create a profile')
    expect(screen.queryByTestId('rail-league')).toBeNull()
    expect(screen.queryByTestId('rail-quests')).toBeNull()
  })

  it('each card follows its own flag', () => {
    renderWithServices(
      <EngagementRail home={home({ flags: { quests: true }, quests: QUESTS }, true)} />,
    )
    expect(screen.getByTestId('rail-quests')).toBeInTheDocument()
    expect(screen.queryByTestId('rail-league')).toBeNull()
  })
})

describe('heartsPopover', () => {
  it('is undefined while flags.shop is off (the pill stays a plain image)', () => {
    expect(heartsPopover(undefined)).toBeUndefined()
    expect(heartsPopover(home({ flags: { quests: true } }))).toBeUndefined()
    render(<StatPill kind="hearts" value={3} popover={heartsPopover(home())} />)
    expect(screen.getByRole('img', { name: '3 hearts' })).toBeInTheDocument()
  })

  it('shows hearts, the next regeneration and refills for coins', async () => {
    const h = home({ flags: ALL_ON })
    const refills: string[] = []
    const { calls } = renderWithServices(
      <StatPill kind="hearts" value={3} popover={heartsPopover(h)} popoverLabel="Hearts" />,
      {
        handlers: {
          shop: () => ({
            ...SHOP,
            coins: 200,
            items: [SHOP.items[0]!, { ...SHOP.items[1]!, unavailable: null }],
          }),
          refillLives: (o) => {
            const id = (o as { body: { purchaseId: string } }).body.purchaseId
            refills.push(id)
            return {
              purchaseId: id,
              item: 'heart_refill',
              replayed: false,
              coins: 50,
              streak: { current: 1, status: 'extended', freezes: 1 },
              lives: { policy: 'hearts', count: 5, max: 5, nextRegenAt: null },
            }
          },
          home: () => h,
        },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: '3 hearts' }))
    const pop = screen.getByTestId('hearts-popover')
    expect(within(pop).getByTestId('hearts-count')).toHaveTextContent('3 of 5')
    expect(within(pop).getByTestId('hearts-next')).toHaveTextContent('Next heart in 1h 29m')
    const refill = await within(pop).findByRole('button', {
      name: /^refill hearts for 150 coins$/i,
    })
    fireEvent.click(refill)
    await waitFor(() =>
      expect(within(pop).getByTestId('hearts-status')).toHaveTextContent('Hearts refilled!'),
    )
    expect(refills).toHaveLength(1)
    expect(calls.filter((c) => c.name === 'refillLives')).toHaveLength(1)
  })

  it('full or unlimited hearts offer no refill', async () => {
    renderWithServices(
      <StatPill
        kind="hearts"
        value={5}
        popover={heartsPopover(
          home({ flags: ALL_ON, lives: { policy: 'hearts', count: 5, max: 5, nextRegenAt: null } }),
        )}
      />,
      { handlers: { shop: () => SHOP } },
    )
    await act(async () => {})
    expect(screen.getByTestId('hearts-next')).toHaveTextContent('Your hearts are full.')
    expect(screen.queryByTestId('hearts-refill')).toBeNull()
    cleanup()
    renderWithServices(
      <StatPill
        kind="hearts"
        value="infinite"
        popover={heartsPopover(
          home({
            flags: ALL_ON,
            lives: { policy: 'unlimited', count: 5, max: 5, nextRegenAt: null },
          }),
        )}
      />,
      { handlers: { shop: () => SHOP } },
    )
    await act(async () => {})
    expect(screen.getByTestId('hearts-count')).toHaveTextContent('Unlimited hearts')
    expect(screen.queryByTestId('hearts-refill')).toBeNull()
  })
})
