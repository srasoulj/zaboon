/**
 * Original, geometric icons for the kit (star, book, dumbbell, chest, trophy, flame, coin, heart,
 * check, cross, flag, lock). Decorative: always `aria-hidden`; the owning control carries the name.
 */
import type { ReactElement, SVGProps } from 'react'

export type IconName =
  | 'star'
  | 'book'
  | 'dumbbell'
  | 'chest'
  | 'trophy'
  | 'flame'
  | 'coin'
  | 'heart'
  | 'check'
  | 'cross'
  | 'flag'
  | 'lock'
  | 'close'

const PATHS: Record<IconName, ReactElement> = {
  star: (
    <path
      d="M12 2.8l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6-4.5-4.2 6.1-.7z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
  book: (
    <g fill="currentColor">
      <rect x="3" y="4" width="8.2" height="16" rx="2" />
      <rect x="12.8" y="4" width="8.2" height="16" rx="2" />
    </g>
  ),
  dumbbell: (
    <g fill="currentColor">
      <rect x="2" y="8" width="3.5" height="8" rx="1.5" />
      <rect x="5" y="5.5" width="4" height="13" rx="1.8" />
      <rect x="15" y="5.5" width="4" height="13" rx="1.8" />
      <rect x="18.5" y="8" width="3.5" height="8" rx="1.5" />
      <rect x="8.5" y="10.5" width="7" height="3" rx="1.2" />
    </g>
  ),
  chest: (
    <g fill="currentColor">
      <rect x="3" y="5" width="18" height="6.5" rx="3" />
      <rect x="3" y="12.5" width="18" height="7.5" rx="2" />
      <rect x="10" y="10" width="4" height="5" rx="1.2" opacity="0.55" />
    </g>
  ),
  trophy: (
    <g fill="currentColor">
      <rect x="6.5" y="3" width="11" height="9" rx="4.5" />
      <rect x="3" y="4.5" width="4.5" height="5" rx="2.2" />
      <rect x="16.5" y="4.5" width="4.5" height="5" rx="2.2" />
      <rect x="10.5" y="11" width="3" height="5" rx="1" />
      <rect x="7" y="16.5" width="10" height="4" rx="1.6" />
    </g>
  ),
  flame: (
    <path
      d="M12 2.5c1.2 3.3 5.8 5.6 5.8 11a5.8 5.8 0 01-11.6 0c0-2.4 1.1-3.9 2.4-5 .1 1.8.9 3 2 3.4-.6-3.3.3-6.6 1.4-9.4z"
      fill="currentColor"
    />
  ),
  coin: (
    <g>
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <rect x="10.2" y="6.5" width="3.6" height="11" rx="1.8" fill="#FFFFFF" opacity="0.6" />
    </g>
  ),
  heart: (
    <path
      d="M12 20.5c-.4 0-8.5-4.9-8.5-10.6A4.7 4.7 0 0112 7.1a4.7 4.7 0 018.5 2.8c0 5.7-8.1 10.6-8.5 10.6z"
      fill="currentColor"
    />
  ),
  check: (
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  ),
  cross: (
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  ),
  close: (
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  ),
  flag: (
    <g fill="currentColor">
      <rect x="4.5" y="3" width="2.5" height="18" rx="1.2" />
      <path d="M7 4h11.5l-3 4.5 3 4.5H7z" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.5" />
    </g>
  ),
  lock: (
    <g fill="currentColor">
      <rect x="4.5" y="10" width="15" height="11" rx="3" />
      <path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  ),
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 24, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
