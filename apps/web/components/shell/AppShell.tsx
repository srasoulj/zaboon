'use client'
/**
 * The app chrome around every signed-in screen (orchestrator-owned; DESIGN-SYSTEM §2.1):
 * desktop = sidebar + center + right rail with the stats row; tablet = icon sidebar;
 * mobile = stats bar on top + tab bar at the bottom. Onboarding renders without chrome.
 */
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { StatPill } from '@zaboon/ui'
import type { HomeResponse } from '@zaboon/contracts'
import { useEnsureGuest, useHome } from '@/lib/app-services'
import { CourseBadge, LearnIcon, LettersIcon, PracticeIcon, ProfileIcon } from './nav-icons'

interface NavItem {
  href: string
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/learn', label: 'Learn', Icon: LearnIcon },
  { href: '/letters', label: 'Letters', Icon: LettersIcon },
  { href: '/practice', label: 'Practice', Icon: PracticeIcon },
  { href: '/profile', label: 'Profile', Icon: ProfileIcon },
]

function Stats({ home }: { home: HomeResponse | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2" data-testid="stats">
      <CourseBadge />
      <StatPill
        kind="streak"
        value={home?.streak.current ?? 0}
        active={home?.streak.status === 'extended'}
      />
      <StatPill
        kind="hearts"
        value={home?.lives.policy === 'unlimited' ? 'infinite' : (home?.lives.count ?? 5)}
      />
    </div>
  )
}

function NavLinks({ variant, pathname }: { variant: 'side' | 'tab'; pathname: string }) {
  return (
    <ul className={clsx(variant === 'side' ? 'flex flex-col gap-2' : 'flex justify-around')}>
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              aria-label={variant === 'tab' ? label : undefined}
              className={clsx(
                'flex items-center gap-4 rounded-[var(--radius-tile)] border-2 font-extrabold uppercase tracking-wide',
                variant === 'side' ? 'px-3 py-2 text-[15px]' : 'p-2',
                active
                  ? 'border-selected-border bg-selected-bg text-lajvard-500 dark:text-ink'
                  : 'border-transparent text-stone hover:bg-mist',
              )}
            >
              <Icon />
              {variant === 'side' && <span className="hidden desktop:inline">{label}</span>}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useEnsureGuest()
  const home = useHome(session !== null)
  const pathname = usePathname()
  const router = useRouter()
  const onboarding = pathname.startsWith('/onboarding')

  useEffect(() => {
    if (home.data && !home.data.user.onboarded && !onboarding) router.replace('/onboarding')
  }, [home.data, onboarding, router])

  if (onboarding) return <main className="min-h-dvh bg-bg text-ink">{children}</main>

  return (
    <div className="min-h-dvh bg-bg text-ink tablet:flex">
      <nav
        aria-label="Main"
        className="sticky top-0 hidden h-dvh shrink-0 flex-col gap-6 border-r-2 border-line px-3 py-6 tablet:flex tablet:w-24 desktop:w-64 desktop:px-4"
      >
        <Link
          href="/learn"
          className="px-3 text-3xl font-black tracking-tight text-firouzeh-500"
          aria-label="Zaboon home"
        >
          <span className="hidden desktop:inline">zaboon</span>
          <span className="desktop:hidden" aria-hidden>
            z
          </span>
        </Link>
        <NavLinks variant="side" pathname={pathname} />
      </nav>

      <header className="sticky top-0 z-10 border-b-2 border-line bg-bg px-4 py-3 desktop:hidden">
        <Stats home={home.data} />
      </header>

      <main id="main" className="mx-auto w-full max-w-[600px] flex-1 px-4 pt-6 pb-28 tablet:pb-10">
        {children}
      </main>

      <aside
        aria-label="Your progress"
        className="sticky top-0 hidden h-dvh w-80 shrink-0 flex-col gap-6 px-6 py-6 desktop:flex"
      >
        <Stats home={home.data} />
        {home.data && (
          <section
            className="rounded-[var(--radius-card)] border-2 border-line p-5"
            data-testid="daily-goal"
          >
            <h2 className="text-lg font-extrabold">Daily goal</h2>
            <p className="text-stone">
              {home.data.dailyGoal.xp} / {home.data.dailyGoal.goal} XP
            </p>
          </section>
        )}
      </aside>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-line bg-bg px-2 py-2 tablet:hidden"
      >
        <NavLinks variant="tab" pathname={pathname} />
      </nav>
    </div>
  )
}
