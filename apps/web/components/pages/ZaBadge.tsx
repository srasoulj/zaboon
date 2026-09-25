/**
 * The course badge (DESIGN-SYSTEM §2.3, §9): a turquoise tile with ز, never a national flag.
 * Decorative by default; pass `label` when it stands alone.
 */
export function ZaBadge({ size = 64, label }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-firouzeh-500)" />
      <rect x="1" y="27" width="30" height="4" rx="2" fill="var(--color-firouzeh-600)" />
      <text
        x="16"
        y="21.5"
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
