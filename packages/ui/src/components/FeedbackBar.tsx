'use client'
import clsx from 'clsx'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../icons'
import { Button3D } from './Button3D'

export type FeedbackStatus = 'correct' | 'wrong'

export interface FeedbackBarProps {
  status: FeedbackStatus
  /** Defaults: "Nice!" / "Correct solution:". */
  title?: ReactNode
  /** The solution (render Persian through FaText; diffs highlight whole words). */
  solution?: ReactNode
  /** Extra line under the solution (e.g. meaning, transliteration). */
  detail?: ReactNode
  onContinue: () => void
  continueLabel?: string
  /** Shows the report flag (wrong answers). */
  onReport?: () => void
  reportLabel?: string
  /** Focus CONTINUE on mount so Enter continues (§8). Default true. */
  autoFocus?: boolean
  className?: string
}

/**
 * The lesson footer after CHECK. Announced through a live region, always icon + text (never color
 * alone), slides up with a ≈300ms spring (CSS, so SSR and hydration agree) unless reduced motion is on.
 */
export function FeedbackBar({
  status,
  title,
  solution,
  detail,
  onContinue,
  continueLabel = 'Continue',
  onReport,
  reportLabel = 'Report a problem',
  autoFocus = true,
  className,
}: FeedbackBarProps) {
  const continueRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (autoFocus) continueRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const heading = title ?? (status === 'correct' ? 'Nice!' : 'Correct solution:')
  return (
    <section
      className={clsx('zb-feedback', `zb-feedback--${status}`, className)}
      aria-label={status === 'correct' ? 'Correct answer' : 'Incorrect answer'}
      data-status={status}
    >
      <div className="zb-feedback__inner">
        <div className="zb-feedback__body" role="alert">
          <span className="zb-feedback__icon">
            <Icon name={status === 'correct' ? 'check' : 'cross'} size={28} />
          </span>
          <div className="zb-feedback__text">
            <h2 className="zb-feedback__title">{heading}</h2>
            {solution !== undefined && <div className="zb-feedback__solution">{solution}</div>}
            {detail !== undefined && <div className="zb-feedback__detail">{detail}</div>}
          </div>
        </div>
        <div className="zb-feedback__actions">
          {onReport && (
            <button type="button" className="zb-feedback__report" onClick={onReport} aria-label={reportLabel}>
              <Icon name="flag" size={22} />
            </button>
          )}
          <Button3D ref={continueRef} variant={status === 'correct' ? 'primary' : 'danger'} onClick={onContinue} className="zb-feedback__continue">
            {continueLabel}
          </Button3D>
        </div>
      </div>
    </section>
  )
}
