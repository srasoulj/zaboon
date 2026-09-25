import clsx from 'clsx'

/**
 * A whole Persian string (a word, or a letter form shaped with ZWJ) marked up for screen readers
 * and the bidi algorithm. Never wrap part of a word: that breaks letter joining (CLAUDE.md rule 5).
 */
export function Persian({
  children,
  className,
  as: Tag = 'span',
}: {
  children: string
  className?: string
  as?: 'span' | 'p' | 'div'
}) {
  return (
    <Tag
      lang="fa"
      dir="rtl"
      className={clsx('font-bold leading-[1.9]', className)}
      style={{ fontFamily: 'var(--font-persian)' }}
    >
      {children}
    </Tag>
  )
}
