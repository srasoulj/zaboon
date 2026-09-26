'use client'
/**
 * /leaderboard (flags.leagues; DESIGN-SYSTEM §2.3): the learner's league tier, this week's cohort
 * in rank order with its promotion and demotion zones, a countdown to the week's end and last
 * week's result. Guests see "Create a profile to join leagues" (leagues need a linked account).
 * Refetches on focus and after each lesson (ARCHITECTURE §6: no Realtime).
 */
import clsx from 'clsx'
import { useQuery } from '@tanstack/react-query'
import type { LeaderboardEntry, LeaderboardResponse, LeagueResult } from '@zaboon/contracts'
import { Icon } from '@zaboon/ui'
import { ButtonLink } from '@/components/pages/ButtonLink'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { Countdown, TIER_NAMES, TierName, ZONE_LABEL, leagueName } from './shared'
import { FeatureOff, PageLoading } from './states'

export function LeaderboardScreen() {
  const api = useApi()
  const session = useSession()
  const home = useHome(session.status === 'signed_in')
  const flags = home.data?.flags
  const member = home.data !== undefined && !home.data.user.isAnonymous
  const board = useQuery<LeaderboardResponse>({
    queryKey: queryKeys.leaderboard,
    queryFn: () => api('leaderboard'),
    enabled: member && flags?.leagues === true,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  })

  if (!home.data) return <PageLoading label="Loading leaderboard…" />
  if (flags?.leagues !== true) return <FeatureOff title="Leaderboards" />
  if (!member) return <GuestLeagues />

  return (
    <section aria-labelledby="leaderboard-title" className="flex flex-col gap-6">
      {board.data ? (
        <Board data={board.data} />
      ) : board.isError ? (
        <>
          <h1 id="leaderboard-title" className="text-[28px] font-extrabold">
            Leaderboard
          </h1>
          <p role="alert" className="text-stone font-bold">
            We couldn&apos;t load the leaderboard.
          </p>
        </>
      ) : (
        <>
          <h1 id="leaderboard-title" className="text-[28px] font-extrabold">
            Leaderboard
          </h1>
          <p role="status" className="text-stone font-bold">
            Loading leaderboard…
          </p>
        </>
      )}
    </section>
  )
}

function GuestLeagues() {
  return (
    <section
      aria-labelledby="leaderboard-title"
      className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border-2 border-line p-6 text-center"
      data-testid="leagues-guest"
    >
      <Icon name="trophy" size={96} className="text-zaferan-500" />
      <h1 id="leaderboard-title" className="text-[24px] font-extrabold">
        Create a profile to join leagues
      </h1>
      <p className="text-stone font-bold">
        Compete with learners who earn about as much XP as you each week, and climb from the{' '}
        {TIER_NAMES.mes.name} League to {TIER_NAMES.almas.name}.
      </p>
      <ButtonLink href="/settings/account" fullWidth>
        Create a profile
      </ButtonLink>
    </section>
  )
}

function Board({ data }: { data: LeaderboardResponse }) {
  return (
    <>
      <header
        className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-5 text-center"
        data-testid="league-banner"
      >
        <Icon name="trophy" size={72} className="text-zaferan-500" />
        <h1 id="leaderboard-title" className="text-[26px] font-extrabold">
          <TierName tier={data.tier} />
        </h1>
        <p className="text-stone font-bold">{TIER_NAMES[data.tier].en}</p>
        <Countdown until={data.week.endsAt} prefix="Week ends in" testId="league-countdown" />
      </header>

      {data.lastResult && <LastResult result={data.lastResult} />}

      {data.joined ? (
        <Cohort data={data} />
      ) : (
        <p
          className="rounded-[var(--radius-card)] border-2 border-line p-5 text-center font-bold text-stone"
          data-testid="league-not-joined"
        >
          Finish a lesson this week to join the {leagueName(data.tier)}.
        </p>
      )}
    </>
  )
}

function LastResult({ result }: { result: LeagueResult }) {
  const text =
    result.outcome === 'promote'
      ? `You finished #${result.rank} and moved up to the ${leagueName(result.newTier)}!`
      : result.outcome === 'demote'
        ? `You finished #${result.rank} and moved down to the ${leagueName(result.newTier)}.`
        : `You finished #${result.rank} and stayed in the ${leagueName(result.newTier)}.`
  return (
    <p
      role="status"
      className={clsx(
        'rounded-[var(--radius-card)] border-2 p-4 font-bold',
        result.outcome === 'promote'
          ? 'border-pesteh-600 bg-pesteh-100 text-ink dark:bg-bg'
          : 'border-line',
      )}
      data-testid="league-last-result"
      data-outcome={result.outcome}
    >
      {text}
      {result.coins > 0 && ` +${result.coins} coins.`}
    </p>
  )
}

function Cohort({ data }: { data: LeaderboardResponse }) {
  return (
    <section aria-labelledby="cohort-title">
      <h2 id="cohort-title" className="mb-2 text-[20px] font-extrabold">
        This week
      </h2>
      <p className="mb-3 text-stone font-bold">
        {data.promoteCount > 0 && `Top ${data.promoteCount} move up`}
        {data.promoteCount > 0 && data.demoteCount > 0 && ' · '}
        {data.demoteCount > 0 && `bottom ${data.demoteCount} move down`}
      </p>
      <ol className="flex flex-col" data-testid="league-members">
        {data.members.map((m, i) => (
          <MemberRow
            key={`${m.rank}-${i}`}
            m={m}
            zoneStart={i > 0 && data.members[i - 1]!.zone !== m.zone}
          />
        ))}
      </ol>
    </section>
  )
}

function MemberRow({ m, zoneStart }: { m: LeaderboardEntry; zoneStart: boolean }) {
  const name = m.displayName ?? m.username ?? 'Learner'
  return (
    <li
      className={clsx(
        'flex items-center gap-3 rounded-[var(--radius-tile)] px-3 py-2',
        zoneStart && 'mt-3 border-t-2 border-dashed border-line pt-3',
        m.isMe && 'border-2 border-selected-border bg-selected-bg',
      )}
      data-testid="league-member"
      data-rank={m.rank}
      data-zone={m.zone}
      data-me={m.isMe ? 'true' : 'false'}
      aria-current={m.isMe ? 'true' : undefined}
    >
      <span
        className={clsx(
          'w-8 text-center text-[18px] font-extrabold',
          m.isMe
            ? 'text-ink'
            : m.zone === 'promote'
              ? 'text-correct-fg'
              : m.zone === 'demote'
                ? 'text-wrong-fg'
                : 'text-stone',
        )}
      >
        {m.rank}
      </span>
      <span className="flex-1 truncate font-extrabold">
        <bdi data-testid="league-member-name">{name}</bdi>
        {/* On the selected tint, stone text is below 4.5:1: the "you" row stays ink. */}
        {m.isMe && <span> (you)</span>}
      </span>
      <span className={clsx('font-bold', m.isMe ? 'text-ink' : 'text-stone')}>{m.weeklyXp} XP</span>
      <span className="zb-sr-only">{ZONE_LABEL[m.zone]}</span>
      {m.zone !== 'stay' && (
        <Icon
          name={m.zone === 'promote' ? 'star' : 'cross'}
          size={18}
          className={m.zone === 'promote' ? 'text-correct-fg' : 'text-wrong-fg'}
        />
      )}
    </li>
  )
}
