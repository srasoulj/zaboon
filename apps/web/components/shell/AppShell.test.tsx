/** The app shell's Wave 3 seams: flag-gated nav items, the coins pill and the engagement slots. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, FLAG_DEFAULTS, type HomeResponse } from '@zaboon/contracts'
import type { ApiClient } from '@/lib/api-client'
import { AppServicesProvider } from '@/lib/app-services'
import type { AuthClient, AuthSession } from '@/lib/auth-client'
import { AppShell, NAV_ITEMS, navItems } from './AppShell'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/letters',
}))

afterEach(() => {
  cleanup()
  replace.mockClear()
})

const USER_ID = '00000000-0000-4000-8000-00000000000a'
const SESSION: AuthSession = {
  accessToken: 'token',
  expiresAt: Date.now() + 3_600_000,
  userId: USER_ID,
  isAnonymous: true,
  email: null,
}

function home(over: Partial<HomeResponse> = {}): HomeResponse {
  return {
    user: {
      id: USER_ID,
      isAnonymous: true,
      displayName: null,
      username: null,
      ageConfirmed: true,
      onboarded: true,
    },
    course: { id: 'fixture', contentVersion: 1, currentLevelId: 'u01-l1' },
    streak: { current: 2, status: 'extended', freezes: 1 },
    lives: { policy: 'hearts', count: 4, max: 5, nextRegenAt: null },
    dailyGoal: { xp: 10, goal: 20, met: false },
    xpTotal: 25,
    settings: DEFAULT_SETTINGS,
    flags: { ...FLAG_DEFAULTS },
    ...over,
  }
}

function renderShell(data: HomeResponse, session: AuthSession = SESSION) {
  const auth = {
    mode: 'local',
    getSession: async () => session,
    signInAsGuest: vi.fn(async () => session),
    subscribe: () => () => {},
  } as unknown as AuthClient
  const api = vi.fn(async (name: string) => {
    if (name === 'home') return data
    throw new Error(`unexpected API call ${name}`)
  }) as unknown as ApiClient
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider auth={auth} api={api}>
        <AppShell>
          <h1>Letters</h1>
        </AppShell>
      </AppServicesProvider>
    </QueryClientProvider>,
  )
}

/** [sidebar, mobile tab bar]: both are in the DOM (CSS shows one per breakpoint). */
const navs = () => screen.getAllByRole('navigation', { name: 'Main' })
const tabBarHrefs = () =>
  within(navs()[1]!)
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'))

async function loaded() {
  await waitFor(() => expect(screen.getAllByTestId('daily-goal')).toHaveLength(1))
}

describe('AppShell', () => {
  it('shows the MVP chrome while every Wave 3 flag is off', async () => {
    renderShell(home())
    await loaded()
    expect(navs()).toHaveLength(2)
    expect(tabBarHrefs()).toEqual(['/learn', '/letters', '/practice', '/profile'])
    for (const nav of navs()) {
      const links = within(nav).getAllByRole('link', { name: /learn|letters|practice|profile/i })
      expect(links.map((a) => a.getAttribute('href'))).toEqual(
        expect.arrayContaining(['/learn', '/letters', '/practice', '/profile']),
      )
      expect(within(nav).queryByRole('link', { name: /leaderboards|quests|shop/i })).toBeNull()
      expect(within(nav).getByRole('link', { name: /letters/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
    }
    for (const stats of screen.getAllByTestId('stats')) {
      expect(within(stats).getByRole('img', { name: '2 day streak' })).toBeInTheDocument()
      expect(within(stats).getByRole('img', { name: '4 hearts' })).toBeInTheDocument()
      expect(within(stats).queryByRole('img', { name: /coins?$/ })).toBeNull()
    }
    expect(screen.getByRole('complementary', { name: 'Your progress' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('Letters')
    expect(replace).not.toHaveBeenCalled()
  })

  it('adds Leaderboards, Quests and Shop while their flags are on', async () => {
    renderShell(home({ flags: { ...FLAG_DEFAULTS, leagues: true, quests: true, shop: true } }))
    await waitFor(() =>
      expect(within(navs()[0]!).getByRole('link', { name: /shop/i })).toBeInTheDocument(),
    )
    for (const nav of navs()) {
      expect(within(nav).getByRole('link', { name: /leaderboards/i })).toHaveAttribute(
        'href',
        '/leaderboard',
      )
      expect(within(nav).getByRole('link', { name: /quests/i })).toHaveAttribute('href', '/quests')
      expect(within(nav).getByRole('link', { name: /shop/i })).toHaveAttribute('href', '/shop')
    }
    expect(tabBarHrefs()).toEqual([
      '/learn',
      '/letters',
      '/practice',
      '/leaderboard',
      '/quests',
      '/shop',
      '/profile',
    ])
  })

  it('shows a coins pill only when home carries coins', async () => {
    renderShell(home({ coins: 120 }))
    await loaded()
    for (const stats of screen.getAllByTestId('stats'))
      expect(within(stats).getByRole('img', { name: '120 coins' })).toBeInTheDocument()
  })

  it('gates nav items per flag', () => {
    const ids = (flags?: Record<string, boolean>) => navItems(flags).map((i) => i.href)
    expect(ids(undefined)).toEqual(['/learn', '/letters', '/practice', '/profile'])
    expect(ids({ ...FLAG_DEFAULTS })).toEqual(['/learn', '/letters', '/practice', '/profile'])
    expect(ids({ shop: true })).toEqual(['/learn', '/letters', '/practice', '/shop', '/profile'])
    expect(NAV_ITEMS.filter((i) => i.flag).map((i) => [i.label, i.flag])).toEqual([
      ['Leaderboards', 'leagues'],
      ['Quests', 'quests'],
      ['Shop', 'shop'],
    ])
  })
})

describe('AppShell: the dropped-merge notice (ws-pages)', () => {
  const MEMBER: AuthSession = {
    ...SESSION,
    userId: '00000000-0000-4000-8000-00000000000b',
    isAnonymous: false,
  }
  afterEach(() => window.localStorage.clear())
  const member = home({ user: { ...home().user, id: MEMBER.userId, isAnonymous: false } })

  it('shows the note to the member it is for, in the main column', async () => {
    window.localStorage.setItem('zaboon.mergeDropped', JSON.stringify({ userId: MEMBER.userId }))
    renderShell(member, MEMBER)
    const note = await screen.findByTestId('merge-dropped')
    expect(screen.getByRole('main')).toContainElement(note)
  })

  it('never shows it to another member or a guest', async () => {
    window.localStorage.setItem('zaboon.mergeDropped', JSON.stringify({ userId: 'someone-else' }))
    renderShell(member, MEMBER)
    await loaded()
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
    cleanup()
    window.localStorage.setItem('zaboon.mergeDropped', JSON.stringify({ userId: SESSION.userId }))
    renderShell(home())
    await loaded()
    expect(screen.queryByTestId('merge-dropped')).toBeNull()
  })
})
