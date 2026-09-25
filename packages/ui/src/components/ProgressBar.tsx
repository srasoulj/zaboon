'use client'
import clsx from 'clsx'

export interface ProgressBarProps {
  /** 0..1 */
  value: number
  /** Current combo ("N in a row"). The bar glows and shows a badge from `streakThreshold`. */
  streak?: number
  streakThreshold?: number
  label?: string
  className?: string
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/** Lesson progress: rounded track, filled bar with a highlight stripe, combo glow + badge. */
export function ProgressBar({ value, streak = 0, streakThreshold = 3, label = 'Lesson progress', className }: ProgressBarProps) {
  const pct = Math.round(clamp01(value) * 100)
  const glowing = streak >= streakThreshold
  return (
    <div className={clsx('zb-progress', glowing && 'zb-progress--glow', className)}>
      <div
        className="zb-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="zb-progress__fill" style={{ inlineSize: `${pct}%` }}>
          <span className="zb-progress__stripe" />
        </div>
      </div>
      {glowing && (
        <span className="zb-progress__badge" role="status">
          {streak} in a row
        </span>
      )}
    </div>
  )
}
