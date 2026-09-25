'use client'
/**
 * SLOT, owned by ws-engagement (Wave 3): the engagement cards in the app shell's right rail, under
 * the daily goal (DESIGN-SYSTEM §2.1: league card, daily quests, "create a profile"). The shell
 * (components/shell/AppShell.tsx, orchestrator-owned) renders `<EngagementRail home={…} />` once
 * home has loaded. Every card belongs to a feature flag and renders nothing while it is off, so
 * with all flags off the rail is exactly the MVP's.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { HomeResponse, LeagueSummary } from '@zaboon/contracts'
import { Icon } from '@zaboon/ui'
import { ButtonLink } from '@/components/pages/ButtonLink'
import { QuestList, TierName, ZONE_LABEL } from './shared'

export interface EngagementRailProps {
  home: HomeResponse
}

export function EngagementRail({ home }: EngagementRailProps) {
  const f = home.flags
  const guest = home.user.isAnonymous
  const cards = [
    f.leagues === true && !guest && home.league && <LeagueCard key="league" league={home.league} />,
    f.quests === true && home.quests && <QuestsCard key="quests" quests={home.quests} />,
    // Leagues need a linked account; the profile card invites guests while leagues are on.
    f.leagues === true && guest && <ProfileCard key="profile" />,
  ].filter(Boolean)
  if (cards.length === 0) return null
  return <div className="flex flex-col gap-6">{cards}</div>
}

function Card({
  title,
  href,
  testId,
  children,
}: {
  title: string
  href?: string
  testId: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-card)] border-2 border-line p-5" data-testid={testId}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {href && (
          <Link
            href={href}
            className="text-[14px] font-extrabold uppercase text-lajvard-500 dark:text-ink"
          >
            View
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function LeagueCard({ league }: { league: LeagueSummary }) {
  return (
    <Card title="League" href="/leaderboard" testId="rail-league">
      <div className="flex items-center gap-3">
        <Icon name="trophy" size={48} className="text-zaferan-500" />
        <div className="flex flex-col">
          <TierName tier={league.tier} className="font-extrabold" />
          {league.joined && league.rank !== null ? (
            <p className="text-stone font-bold" data-testid="rail-league-rank">
              #{league.rank} · {league.weeklyXp} XP
              {league.zone && league.zone !== 'stay' && ` · ${ZONE_LABEL[league.zone]}`}
            </p>
          ) : (
            <p className="text-stone font-bold">Finish a lesson to join this week&apos;s league.</p>
          )}
        </div>
      </div>
    </Card>
  )
}

function QuestsCard({ quests }: { quests: NonNullable<HomeResponse['quests']> }) {
  return (
    <Card title="Daily quests" href="/quests" testId="rail-quests">
      <QuestList quests={quests} compact />
    </Card>
  )
}

function ProfileCard() {
  return (
    <section
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-line p-5"
      data-testid="rail-profile"
    >
      <h2 className="text-lg font-extrabold">Create a profile to save your progress!</h2>
      <p className="text-stone font-bold">You&apos;ll also be able to join leagues.</p>
      <ButtonLink href="/settings/account" fullWidth>
        Create a profile
      </ButtonLink>
    </section>
  )
}
