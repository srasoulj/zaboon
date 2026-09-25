'use client'
/**
 * Shared pieces of the P2 engagement UI (leaderboard, quests, shop, rail cards, lesson-complete
 * screens): league tier names, quest progress rows, countdowns. Display only: every number comes
 * from the server (ARCHITECTURE §3.1).
 */
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import type { LeagueOutcome, LeagueTier, QuestDto } from '@zaboon/contracts'
import { Icon } from '@zaboon/ui'

/** League tiers are Persian gems and metals (ARCHITECTURE §6), low to high. */
export const TIER_NAMES: Record<LeagueTier, { name: string; fa: string; en: string }> = {
  mes: { name: 'Mes', fa: 'مس', en: 'Copper' },
  noqreh: { name: 'Noqreh', fa: 'نقره', en: 'Silver' },
  tala: { name: 'Talā', fa: 'طلا', en: 'Gold' },
  firouzeh: { name: 'Firouzeh', fa: 'فیروزه', en: 'Turquoise' },
  aqiq: { name: 'Aqiq', fa: 'عقیق', en: 'Agate' },
  lajvard: { name: 'Lājvard', fa: 'لاجورد', en: 'Lapis' },
  yaqut: { name: 'Yāqut', fa: 'یاقوت', en: 'Ruby' },
  zomorrod: { name: 'Zomorrod', fa: 'زمرد', en: 'Emerald' },
  morvarid: { name: 'Morvārid', fa: 'مروارید', en: 'Pearl' },
  almas: { name: 'Almās', fa: 'الماس', en: 'Diamond' },
}

export const leagueName = (tier: LeagueTier) => `${TIER_NAMES[tier].name} League`

/** The tier's name with its Persian word, as one RTL island (never split inside the word). */
export function TierName({ tier, className }: { tier: LeagueTier; className?: string }) {
  const t = TIER_NAMES[tier]
  return (
    <span className={className} data-testid="tier-name" data-tier={tier}>
      {leagueName(tier)}{' '}
      <span lang="fa" dir="rtl" className="font-persian">
        {t.fa}
      </span>
    </span>
  )
}

export const ZONE_LABEL: Record<LeagueOutcome, string> = {
  promote: 'Promotion zone',
  stay: 'Safe',
  demote: 'Demotion zone',
}

/** "2d 5h", "5h 12m", "12m" or "less than a minute" until `target`. */
export function formatRemaining(ms: number): string {
  if (ms <= 60_000) return 'less than a minute'
  const minutes = Math.floor(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** The current time, refreshed every `everyMs` (countdowns). */
export function useNow(everyMs = 30_000, now: () => number = Date.now): number {
  const [t, setT] = useState(now)
  useEffect(() => {
    const id = setInterval(() => setT(now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs, now])
  return t
}

export function Countdown({
  until,
  prefix,
  testId,
}: {
  until: string
  prefix: string
  testId: string
}) {
  const now = useNow()
  const left = Math.max(0, Date.parse(until) - now)
  return (
    <p className="text-stone font-bold" data-testid={testId} data-until={until}>
      {prefix} <time dateTime={until}>{formatRemaining(left)}</time>
    </p>
  )
}

/** A quest's progress bar (Pesteh, DESIGN-SYSTEM §4.1: quests = pistachio). */
export function QuestRow({
  quest,
  compact = false,
  highlight = false,
}: {
  quest: Pick<QuestDto, 'id' | 'title' | 'target' | 'progress' | 'completed' | 'reward'>
  compact?: boolean
  highlight?: boolean
}) {
  const pct = Math.round((Math.min(quest.progress, quest.target) / quest.target) * 100)
  return (
    <li
      className={clsx('flex items-center gap-3', compact ? 'py-1' : 'py-2')}
      data-testid="quest"
      data-quest={quest.id}
      data-completed={quest.completed ? 'true' : 'false'}
    >
      <Icon
        name={quest.completed ? 'check' : 'chest'}
        size={compact ? 28 : 36}
        className={quest.completed ? 'text-pesteh-600' : 'text-zaferan-500'}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={clsx('font-extrabold', compact ? 'text-[15px]' : 'text-[17px]')}>
            {quest.title}
          </span>
          <span className="text-[14px] font-bold text-stone" aria-hidden="true">
            {Math.min(quest.progress, quest.target)} / {quest.target}
          </span>
        </span>
        <div
          className="h-3 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label={quest.title}
          aria-valuemin={0}
          aria-valuemax={quest.target}
          aria-valuenow={Math.min(quest.progress, quest.target)}
          aria-valuetext={`${Math.min(quest.progress, quest.target)} of ${quest.target}`}
        >
          <div
            className={clsx(
              'h-full rounded-full bg-pesteh-500',
              highlight && 'motion-safe:transition-[inline-size] motion-safe:duration-700',
            )}
            style={{ inlineSize: `${pct}%` }}
          />
        </div>
      </div>
      {!compact && (
        <span className="flex items-center gap-1 font-extrabold text-lajvard-500 dark:text-ink">
          <Icon name="coin" size={20} className="text-lajvard-500" />
          <span className="zb-sr-only">Reward:</span>
          {quest.reward}
        </span>
      )}
    </li>
  )
}

export function QuestList({
  quests,
  compact = false,
  highlight,
}: {
  quests: readonly QuestDto[]
  compact?: boolean
  /** Quest ids to animate (just advanced). */
  highlight?: ReadonlySet<string>
}) {
  return (
    <ul className="flex flex-col" data-testid="quest-list">
      {quests.map((q) => (
        <QuestRow key={q.id} quest={q} compact={compact} highlight={highlight?.has(q.id)} />
      ))}
    </ul>
  )
}
