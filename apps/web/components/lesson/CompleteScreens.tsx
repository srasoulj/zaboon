'use client'
/**
 * The lesson-complete sequence (DESIGN-SYSTEM §2.3): XP / accuracy / time cards with count-up →
 * streak extended → daily goal (when just met) → back to the path. Confetti and count-ups respect
 * reduced motion (§8).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button3D, Character, ConfettiBurst, Icon, usePrefersReducedMotion } from '@zaboon/ui'
import { formatDuration, type CompleteSummary } from '../../lib/lesson/summary'

/** Counts from 0 to `target` over `duration` ms (instantly under reduced motion). */
export function useCountUp(target: number, duration = 900): number {
  const reduce = usePrefersReducedMotion()
  const [value, setValue] = useState(reduce ? target : 0)
  const frame = useRef<number | null>(null)
  useEffect(() => {
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      frame.current = null
      const t = setTimeout(() => setValue(target), 0)
      return () => clearTimeout(t)
    }
    const start = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration)
      setValue(Math.round(target * (1 - (1 - k) ** 3)))
      if (k < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [target, duration, reduce])
  return value
}

function StatCard({
  label,
  tone,
  testId,
  final,
  children,
}: {
  label: string
  tone: 'zaferan' | 'firouzeh' | 'lajvard'
  testId: string
  final: string
  children: ReactNode
}) {
  const border = {
    zaferan: 'border-zaferan-500',
    firouzeh: 'border-firouzeh-500',
    lajvard: 'border-lajvard-500',
  }[tone]
  const fill = {
    zaferan: 'bg-zaferan-500 text-ink',
    firouzeh: 'bg-firouzeh-600 text-white',
    lajvard: 'bg-lajvard-500 text-white',
  }[tone]
  return (
    <div
      className={clsx('flex-1 overflow-hidden rounded-[16px] border-2', border)}
      data-testid={testId}
      data-value={final}
    >
      <div
        className={clsx(
          'px-2 py-1 text-center text-[13px] font-extrabold uppercase tracking-wide',
          fill,
        )}
      >
        {label}
      </div>
      <div className="px-2 py-3 text-center text-[22px] font-extrabold">
        <span aria-hidden="true">{children}</span>
        <span className="zb-sr-only">{final}</span>
      </div>
    </div>
  )
}

function Screen({
  children,
  onContinue,
  testId,
  source,
}: {
  children: ReactNode
  onContinue: () => void
  testId: string
  source?: CompleteSummary['source']
}) {
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    btn.current?.focus({ preventScroll: true })
  }, [testId])
  return (
    <section className="flex min-h-dvh flex-col" data-testid={testId} data-source={source}>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        {children}
      </div>
      <footer className="border-t-2 border-line px-4 py-5">
        <div className="mx-auto max-w-[640px]">
          <Button3D ref={btn} onClick={onContinue} fullWidth data-testid="complete-continue">
            Continue
          </Button3D>
        </div>
      </footer>
    </section>
  )
}

export function SummaryScreen({
  summary,
  offline,
  onContinue,
}: {
  summary: CompleteSummary
  offline: boolean
  onContinue: () => void
}) {
  const xp = useCountUp(summary.xp)
  const pct = Math.round(summary.accuracy * 100)
  const accuracy = useCountUp(pct)
  return (
    <Screen onContinue={onContinue} testId="complete-summary" source={summary.source}>
      <ConfettiBurst fireKey={1} />
      <Character name="hodhod" mood="celebrate" size={140} decorative />
      <div>
        <h1 className="text-[28px] font-extrabold text-zaferan-600">
          {summary.perfect ? 'Perfect lesson!' : 'Lesson complete!'}
        </h1>
        <p className="text-stone" role="status">
          {summary.source === 'local'
            ? offline
              ? "You're offline. Your progress is saved on this device and will sync when you reconnect."
              : 'Saving your progress…'
            : 'Your progress is saved.'}
        </p>
      </div>
      <div className="flex w-full max-w-[420px] gap-3">
        <StatCard label="Total XP" tone="zaferan" testId="complete-xp" final={String(summary.xp)}>
          <Icon name="star" size={20} className="me-1 inline align-[-3px]" />
          {xp}
        </StatCard>
        <StatCard label="Accuracy" tone="firouzeh" testId="complete-accuracy" final={`${pct}%`}>
          {accuracy}%
        </StatCard>
        <StatCard
          label="Time"
          tone="lajvard"
          testId="complete-time"
          final={formatDuration(summary.durationMs)}
        >
          {formatDuration(summary.durationMs)}
        </StatCard>
      </div>
    </Screen>
  )
}

export function StreakScreen({ days, onContinue }: { days: number; onContinue: () => void }) {
  const shown = useCountUp(days, 700)
  return (
    <Screen onContinue={onContinue} testId="complete-streak">
      <ConfettiBurst fireKey={2} />
      <Icon name="flame" size={120} className="text-zaferan-500" />
      <div data-testid="streak-days" data-value={days}>
        <p className="text-[64px] leading-none font-extrabold text-zaferan-600" aria-hidden="true">
          {shown}
        </p>
        <h1 className="text-[24px] font-extrabold">day streak</h1>
        <p className="zb-sr-only">{`${days} day streak`}</p>
      </div>
      <p className="text-stone">
        {days === 1
          ? 'You started a streak! Come back tomorrow to keep it going.'
          : 'You extended your streak. Keep it up!'}
      </p>
    </Screen>
  )
}

export function DailyGoalScreen({
  xp,
  goal,
  onContinue,
}: {
  xp: number
  goal: number
  onContinue: () => void
}) {
  return (
    <Screen onContinue={onContinue} testId="complete-goal">
      <ConfettiBurst fireKey={3} />
      <Icon name="trophy" size={110} className="text-zaferan-500" />
      <h1 className="text-[28px] font-extrabold">Daily goal complete!</h1>
      <p className="text-stone" data-testid="goal-progress">
        {`${xp} / ${goal} XP today`}
      </p>
    </Screen>
  )
}
