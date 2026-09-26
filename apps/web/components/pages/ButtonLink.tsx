import clsx from 'clsx'
import Link from 'next/link'
import type { ReactNode } from 'react'

/** A link that looks like a Button3D (DESIGN-SYSTEM §4.3), for navigation calls to action. */
export function ButtonLink({
  href,
  variant = 'primary',
  fullWidth = false,
  className,
  children,
}: {
  href: string
  variant?: 'primary' | 'secondary' | 'ghost'
  fullWidth?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'btn-3d zb-btn',
        `zb-btn--${variant}`,
        fullWidth && 'zb-btn--full',
        className,
      )}
    >
      <span className="zb-btn__label">{children}</span>
    </Link>
  )
}
