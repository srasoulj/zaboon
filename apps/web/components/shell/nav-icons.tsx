// App-shell navigation icons (orchestrator-owned). Flat, rounded shapes in the palette.
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
const base = {
  width: 32,
  height: 32,
  viewBox: '0 0 32 32',
  'aria-hidden': true,
  focusable: false,
} as const

export function LearnIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="5" y="13" width="22" height="15" rx="4" fill="var(--color-anar-500)" />
      <path
        d="M3.5 15.5 16 5l12.5 10.5"
        fill="none"
        stroke="var(--color-anar-600)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="13" y="19" width="6" height="9" rx="2" fill="var(--color-zaferan-500)" />
    </svg>
  )
}

export function LettersIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="26" height="26" rx="7" fill="var(--color-firouzeh-500)" />
      <text
        x="16"
        y="23"
        textAnchor="middle"
        fontSize="18"
        fontWeight="800"
        fill="#fff"
        style={{ fontFamily: 'var(--font-persian)' }}
      >
        ز
      </text>
    </svg>
  )
}

export function PracticeIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="4" y="10" width="5" height="12" rx="2" fill="var(--color-lajvard-500)" />
      <rect x="23" y="10" width="5" height="12" rx="2" fill="var(--color-lajvard-500)" />
      <rect x="8" y="14" width="16" height="4" rx="2" fill="var(--color-lajvard-600)" />
      <rect x="1.5" y="13" width="3" height="6" rx="1.5" fill="var(--color-lajvard-600)" />
      <rect x="27.5" y="13" width="3" height="6" rx="1.5" fill="var(--color-lajvard-600)" />
    </svg>
  )
}

/** Leaderboards (P2): a three-step podium. */
export function LeaderboardIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="2.5" y="15" width="9" height="13" rx="2.5" fill="var(--color-lajvard-500)" />
      <rect x="11.5" y="8" width="9" height="20" rx="2.5" fill="var(--color-zaferan-500)" />
      <rect x="20.5" y="19" width="9" height="9" rx="2.5" fill="var(--color-anar-500)" />
      <circle cx="16" cy="4.5" r="2.5" fill="var(--color-zaferan-600)" />
    </svg>
  )
}

/** Quests (P2): a card with a tick. */
export function QuestsIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="5" y="3" width="22" height="26" rx="6" fill="var(--color-pesteh-500)" />
      <path
        d="M10.5 12l3 3 6-6.5"
        fill="none"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="10" y="19.5" width="12" height="4" rx="2" fill="var(--color-pesteh-600)" />
    </svg>
  )
}

/** Shop (P2): a shopping bag. */
export function ShopIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path
        d="M11 12.5V9.5a5 5 0 0 1 10 0v3"
        fill="none"
        stroke="var(--color-lajvard-600)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M6.5 11h19l-1.4 15.1a3 3 0 0 1-3 2.9H10.9a3 3 0 0 1-3-2.9z"
        fill="var(--color-lajvard-500)"
      />
    </svg>
  )
}

export function ProfileIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="16" cy="16" r="13" fill="var(--color-bademjan-100)" />
      <circle cx="16" cy="13" r="5.5" fill="var(--color-bademjan-500)" />
      <path d="M7.5 25.5c1.8-4.2 5-6.3 8.5-6.3s6.7 2.1 8.5 6.3" fill="var(--color-bademjan-500)" />
    </svg>
  )
}

/** The neutral course badge (§2.3): a turquoise tile with ز, never a flag. */
export function CourseBadge({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Persian course">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-firouzeh-500)" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontSize="17"
        fontWeight="800"
        fill="#fff"
        style={{ fontFamily: 'var(--font-persian)' }}
      >
        ز
      </text>
    </svg>
  )
}
