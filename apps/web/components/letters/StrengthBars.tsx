import clsx from 'clsx'
import styles from './letters.module.css'

export const MAX_STRENGTH = 4

/** A 4-step mastery bar (0..4 filled segments), from the API's `strength`. */
export function StrengthBars({ strength, className }: { strength: number; className?: string }) {
  const filled = Math.max(0, Math.min(MAX_STRENGTH, Math.round(strength)))
  return (
    <span
      className={clsx(styles.bars, className)}
      role="img"
      aria-label={`Strength ${filled} of ${MAX_STRENGTH}`}
      data-strength={filled}
    >
      {Array.from({ length: MAX_STRENGTH }, (_, i) => (
        <span key={i} className={clsx(styles.bar, i < filled && styles.barOn)} />
      ))}
    </span>
  )
}
