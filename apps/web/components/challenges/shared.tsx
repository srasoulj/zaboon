'use client'
/**
 * Building blocks shared by the challenge renderers: the frame (instruction heading + centered
 * column), audio buttons, the Persian prompt, choice-list state and small helpers.
 */
import type { ChallengeResponse, FaTextDto, Verdict } from '@zaboon/contracts'
import { PASSING_VERDICTS } from '@zaboon/contracts'
import {
  FaText,
  MotionPreferenceProvider,
  splitWords,
  useDigitShortcuts,
  usePrefersReducedMotion,
  type ChoiceState,
  type FaTextSize,
  type FaToken,
} from '@zaboon/ui'
import clsx from 'clsx'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import type {
  ChallengeAudio,
  ChallengeDisplay,
  ChallengeRendererProps,
} from '@/lib/challenge-registry'
import styles from './challenges.module.css'

// ------------------------------------------------------------------------------------ helpers

type Media = NonNullable<FaTextDto['audio']>

export function isPassing(verdict: Verdict | null): boolean {
  return verdict !== null && PASSING_VERDICTS.includes(verdict)
}

/** Graded state for answer-area visuals during feedback (none while answering). */
export function gradedState(
  phase: ChallengeRendererProps['phase'],
  verdict: Verdict | null,
): 'correct' | 'wrong' | undefined {
  if (phase !== 'feedback' || verdict === null || verdict === 'skipped') return undefined
  return isPassing(verdict) ? 'correct' : 'wrong'
}

/**
 * Persian display tokens for a text: surfaces come from the displayed string (vocalized when
 * vowel marks are on), so punctuation stays attached to its word; transliteration and glosses
 * come from the content tokens (or the phrase transliteration) when the word counts line up.
 */
export function faTokens(dto: FaTextDto, vowelMarks: boolean): FaToken[] {
  const shown = vowelMarks && dto.faVocalized ? dto.faVocalized : dto.fa
  let words = splitWords(shown)
  if (words.length !== splitWords(dto.fa).length) words = splitWords(dto.fa)
  const tokens = dto.tokens ?? []
  if (tokens.length === words.length) {
    return words.map((w, i) => ({
      surface: w.surface,
      translit: tokens[i]!.translit,
      gloss: tokens[i]!.gloss,
    }))
  }
  const translit = dto.translit.split(/\s+/).filter((t) => t.length > 0)
  if (translit.length === words.length)
    return words.map((w, i) => ({ surface: w.surface, translit: translit[i] }))
  return words
}

/** A deterministic shuffle (display order only; grading never depends on it). */
export function seededOrder(count: number, seed: string): number[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

/** Reduced motion from the player's display settings OR the OS/in-app preference. */
export function useReducedMotion(display: ChallengeDisplay): boolean {
  const pref = usePrefersReducedMotion()
  return display.reducedMotion || pref
}

/** Plays `url` once when the challenge mounts, if sound is on (StrictMode-safe). */
export function useAutoplay(
  audio: ChallengeAudio,
  url: string | undefined,
  enabled: boolean,
): void {
  const played = useRef(false)
  useEffect(() => {
    if (!enabled || url === undefined || played.current) return
    played.current = true
    audio.play(url)
  }, [audio, url, enabled])
}

/** Tile ids (`t<index>`) for answer strings: each string takes the first unused tile with that text. */
export function idsForValues(tiles: readonly string[], values: readonly string[]): string[] {
  const used = new Set<number>()
  const ids: string[] = []
  for (const v of values) {
    const i = tiles.findIndex((t, k) => t === v && !used.has(k))
    if (i < 0) continue
    used.add(i)
    ids.push(`t${i}`)
  }
  return ids
}

export function tilesValue(response: ChallengeResponse | null): readonly string[] {
  return response?.kind === 'tiles' ? response.value : []
}

// ---------------------------------------------------------------------------------- the frame

export interface ChallengeFrameProps {
  type: string
  heading: ReactNode
  display: ChallengeDisplay
  children: ReactNode
}

/**
 * Instruction heading + the centered answer column (max 640px). The motion provider is always
 * rendered (so toggling reduced motion never remounts the challenge) and passes on the effective
 * preference: the player's display setting OR the OS/in-app one.
 */
export function ChallengeFrame({ type, heading, display, children }: ChallengeFrameProps) {
  const id = useId()
  const reduce = useReducedMotion(display)
  return (
    <MotionPreferenceProvider reduce={reduce}>
      <section className={styles.frame} aria-labelledby={id} data-challenge={type} lang="en">
        <h2 id={id} className={styles.heading}>
          {heading}
        </h2>
        <div className={styles.body}>{children}</div>
      </section>
    </MotionPreferenceProvider>
  )
}

/**
 * A named group whose English name is read with an English voice: the Persian content inside
 * carries its own lang="fa" (never put an English aria-label on a lang="fa" element).
 */
export function Labelled({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div role="group" aria-label={label} lang="en" className={className}>
      {children}
    </div>
  )
}

/** True while a modal dialog (e.g. the player's quit dialog) is open: shortcuts must not fire. */
export function modalOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') !== null
  )
}

// ------------------------------------------------------------------------------- audio buttons

function SpeakerIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"
        fill="currentColor"
        strokeLinejoin="round"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <path
        d="M15.5 9a4 4 0 0 1 0 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M18 6.5a7.5 7.5 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

function TurtleIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 15a7 6 0 0 1 14 0z" fill="currentColor" />
      <circle cx={20} cy={13} r={2.2} fill="currentColor" />
      <rect x={5} y={15} width={3} height={4} rx={1.5} fill="currentColor" />
      <rect x={14} y={15} width={3} height={4} rx={1.5} fill="currentColor" />
    </svg>
  )
}

export interface AudioButtonProps {
  onPlay: () => void
  slow?: boolean
  size?: 'md' | 'lg'
  label?: string
}

/** Speaker (or 0.7× turtle) button. Always named, so screen-reader users can replay audio. */
export function AudioButton({ onPlay, slow = false, size = 'md', label }: AudioButtonProps) {
  const big = size === 'lg'
  return (
    <button
      type="button"
      className={clsx(
        styles.audioButton,
        big && (slow ? styles.audioButtonSlow : styles.audioButtonLg),
      )}
      aria-label={label ?? (slow ? 'Play slowly' : 'Play audio')}
      onClick={onPlay}
    >
      {slow ? <TurtleIcon size={big ? 48 : 26} /> : <SpeakerIcon size={big ? 56 : 26} />}
    </button>
  )
}

/**
 * Plays a clip. The contract's `slow` flag asks the player for the 0.7× clip; we pass the
 * normal URL (the player maps it to the challenge's slow clip), or the slow URL when that is all
 * the media has.
 */
export function playMedia(audio: ChallengeAudio, media: Media | undefined, slow = false): void {
  const url = media?.normal ?? media?.slow
  if (url === undefined) return
  if (slow) audio.play(url, { slow: true })
  else audio.play(url)
}

/** The big speaker (+ the 0.7× turtle when the media has a slow clip) of listening challenges. */
export function ListenButtons({
  audio,
  media,
}: {
  audio: ChallengeAudio
  media: Media | undefined
}) {
  if (!media?.normal && !media?.slow) return null
  return (
    <div className={styles.audioRow}>
      <AudioButton size="lg" onPlay={() => playMedia(audio, media)} />
      {media.slow !== undefined && (
        <AudioButton size="lg" slow onPlay={() => playMedia(audio, media, true)} />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------- Persian prompt

export interface FaPromptProps {
  dto: FaTextDto
  display: ChallengeDisplay
  audio: ChallengeAudio
  size?: FaTextSize
  /** Accessible name of the phrase group, e.g. "Prompt". */
  label?: string
}

/** A Persian prompt: speaker button (when there is audio) + the text with optional transliteration. */
export function FaPrompt({ dto, display, audio, size = 'lg', label }: FaPromptProps) {
  const tokens = faTokens(dto, display.vowelMarks)
  const perToken = tokens.some((t) => t.translit !== undefined)
  return (
    <div className={styles.prompt}>
      {(dto.audio?.normal ?? dto.audio?.slow) !== undefined && (
        <AudioButton onPlay={() => playMedia(audio, dto.audio)} />
      )}
      <MaybeLabelled label={label}>
        <FaText
          as="p"
          tokens={tokens}
          size={size}
          translit={display.transliteration && perToken}
          vowels={display.vowelMarks}
          className={styles.promptText}
        />
        {display.transliteration && !perToken && (
          <span className={styles.promptTranslit} lang="fa-Latn">
            {dto.translit}
          </span>
        )}
      </MaybeLabelled>
    </div>
  )
}

function MaybeLabelled({ label, children }: { label: string | undefined; children: ReactNode }) {
  return label === undefined ? <div>{children}</div> : <Labelled label={label}>{children}</Labelled>
}

/** Inline Persian (choices, replies) with per-word transliteration when enabled. */
export function FaInline({
  dto,
  display,
  size = 'md',
}: {
  dto: FaTextDto
  display: ChallengeDisplay
  size?: FaTextSize
}) {
  const tokens = faTokens(dto, display.vowelMarks)
  return (
    <FaText
      tokens={tokens}
      size={size}
      translit={display.transliteration && tokens.some((t) => t.translit !== undefined)}
      vowels={display.vowelMarks}
    />
  )
}

// ------------------------------------------------------------------------------- choice state

export interface ChoiceControl {
  selected: number | null
  locked: boolean
  pick(index: number): void
  /** Graded look of option `i` (only during feedback). */
  stateOf(index: number): ChoiceState | undefined
}

/**
 * Single-choice state for the multiple-choice renderers. Selection is controlled by the player's
 * `response`; digits 1–N pick while answering; during feedback the chosen and correct options are
 * highlighted (never before CHECK).
 */
export function useChoice(
  props: Pick<ChallengeRendererProps, 'response' | 'onResponse' | 'phase' | 'verdict'>,
  count: number,
  answer: number,
): ChoiceControl {
  const { response, onResponse, phase } = props
  const selected = response?.kind === 'choice' ? response.value : null
  const locked = phase !== 'answering'
  const pick = (index: number) => {
    if (locked || index < 0 || index >= count) return
    onResponse({ kind: 'choice', value: index })
  }
  useDigitShortcuts(
    count,
    (n) => {
      if (!modalOpen()) pick(n - 1)
    },
    !locked,
  )
  const stateOf = (index: number): ChoiceState | undefined => {
    if (!locked) return undefined
    if (index === answer) return 'correct'
    if (index === selected) return 'wrong'
    return undefined
  }
  return { selected, locked, pick, stateOf }
}

export { styles }
