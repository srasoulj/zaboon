'use client'
import clsx from 'clsx'
import type { ReactNode } from 'react'

/** Structurally compatible with the content-schema sentence token ({surface, translit, gloss}). */
export interface FaToken {
  surface: string
  translit?: string | undefined
  gloss?: string | undefined
}

export type FaTextSize = 'sm' | 'md' | 'lg' | 'xl'

export interface FaTextProps {
  /** Tokens with transliteration/gloss. Takes precedence over `text`. */
  tokens?: readonly FaToken[]
  /** Plain Persian text; split on whitespace into whole-word tokens (a ZWNJ compound stays one word). */
  text?: string
  /** Show the transliteration line under each token: all, none, or decided per token (§1.3 "auto"). */
  translit?: boolean | ((token: FaToken, index: number) => boolean)
  /** Keep short-vowel marks (U+064B–U+0652, U+0670). Default true; false strips them for display. */
  vowels?: boolean
  /** Tap-for-hint: each word becomes a button that calls this with the token and its index. */
  onTokenTap?: (token: FaToken, index: number) => void
  /** Whole-word highlight (e.g. feedback diffs). Never highlights part of a word. */
  highlight?: readonly number[]
  size?: FaTextSize
  /** Element to render: inline by default; `p`/`div` for blocks. */
  as?: 'span' | 'p' | 'div'
  className?: string
  /**
   * Accessible name for the phrase, e.g. "Prompt: I want water". When set, the root gets
   * `role="group"` (a span/p/div cannot carry a name on its own) and keeps its readable content.
   */
  'aria-label'?: string
}

const VOWEL_MARKS = /[\u064B-\u0652\u0670]/g

export function stripVowelMarks(text: string): string {
  return text.replace(VOWEL_MARKS, '')
}

/** Splits on whitespace only: ZWNJ (U+200C) and punctuation stay inside their word. */
export function splitWords(text: string): FaToken[] {
  return text
    .split(/[ \t\n\r\f\v\u00A0]+/)
    .filter((w) => w.length > 0)
    .map((surface) => ({ surface }))
}

/**
 * Persian text with `lang="fa" dir="rtl"` (CLAUDE.md rule 5). Each whole word is exactly one text
 * node inside one element: letters are never wrapped separately, so joining is never broken.
 * The element with `dir` is bidi-isolated, so it can sit inside English sentences.
 */
export function FaText({
  tokens,
  text,
  translit = false,
  vowels = true,
  onTokenTap,
  highlight,
  size = 'md',
  as: Tag = 'span',
  className,
  'aria-label': ariaLabel,
}: FaTextProps) {
  const list: readonly FaToken[] = tokens ?? splitWords(text ?? '')
  const showFor = (t: FaToken, i: number) =>
    typeof translit === 'function' ? translit(t, i) : translit
  const anyTranslit = list.some(showFor)
  const marked = new Set(highlight ?? [])

  const words: ReactNode[] = []
  list.forEach((token, i) => {
    const surface = vowels ? token.surface : stripVowelMarks(token.surface)
    const show = showFor(token, i)
    const wordClass = clsx('zb-fa__word', marked.has(i) && 'zb-fa__word--mark')
    const word = onTokenTap ? (
      <button
        type="button"
        className={clsx(wordClass, 'zb-fa__tap')}
        aria-haspopup="dialog"
        onClick={() => onTokenTap(token, i)}
      >
        {surface}
      </button>
    ) : (
      <span className={wordClass}>{surface}</span>
    )
    if (i > 0) words.push(' ')
    words.push(
      <span key={i} className="zb-fa__token" data-marked={marked.has(i) || undefined}>
        {word}
        {anyTranslit && (
          <span
            className="zb-fa__translit"
            lang="fa-Latn"
            dir="ltr"
            aria-hidden={!show || undefined}
          >
            {show && token.translit ? token.translit : '\u00A0'}
          </span>
        )}
      </span>,
    )
  })

  return (
    <Tag
      lang="fa"
      dir="rtl"
      className={clsx('zb-fa', `zb-fa--${size}`, anyTranslit && 'zb-fa--translit', className)}
      role={ariaLabel !== undefined ? 'group' : undefined}
      aria-label={ariaLabel}
    >
      {words}
    </Tag>
  )
}
