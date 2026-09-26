'use client'
import clsx from 'clsx'
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'

export type Button3DVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'locked'

export interface Button3DProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** DESIGN-SYSTEM §6: primary (firouzeh), secondary (lajvard), danger (anar), ghost (outline), locked (grey). */
  variant?: Button3DVariant
  /** Shows a spinner, sets aria-busy and ignores clicks; the label stays for screen readers. */
  loading?: boolean
  /** Stretch to the container width (lesson footer buttons). */
  fullWidth?: boolean
  /** Optional leading icon (decorative). */
  icon?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/**
 * The chunky 3D button (§4.3). `locked` renders the grey "not ready yet" look (e.g. CHECK before an
 * answer exists) and is `aria-disabled` but stays focusable, so keyboard users can discover it.
 */
export function Button3D({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  icon,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: Button3DProps) {
  const inert = variant === 'locked' || loading
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }
  return (
    <button
      type={type}
      className={clsx(
        'btn-3d zb-btn',
        `zb-btn--${variant}`,
        fullWidth && 'zb-btn--full',
        className,
      )}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      data-variant={variant}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <span className="zb-btn__spinner" aria-hidden="true" /> : icon}
      <span className={clsx('zb-btn__label', loading && 'zb-btn__label--loading')}>{children}</span>
    </button>
  )
}
