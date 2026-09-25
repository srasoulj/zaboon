/**
 * Test harness for the renderer dom tests: fixture challenges plus a stand-in for the lesson
 * player (holds the draft, records every callback, fakes the audio service).
 */
import { cleanup, render } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import {
  Challenge,
  type ChallengeOf,
  type ChallengeResponse,
  type Verdict,
} from '@zaboon/contracts'
import { gradeResponse } from '@zaboon/session-engine'
import { useState, type ReactElement } from 'react'
import { afterEach, expect, vi } from 'vitest'
import type { ChallengeAudio, ChallengeDisplay, ChallengeRenderer } from '@/lib/challenge-registry'
import recorded from './fixtures/fixture-challenges.json'
import { renderers } from './index'

// vitest runs without globals, so Testing Library cannot register its automatic cleanup.
afterEach(() => cleanup())

export const FIXTURES: readonly Challenge[] = (recorded as unknown[]).map((c) => Challenge.parse(c))

export function fixture<T extends Challenge['type']>(type: T, n = 0): ChallengeOf<T> {
  const found = FIXTURES.filter((c) => c.type === type)[n]
  if (!found) throw new Error(`no fixture challenge ${type}#${n}`)
  return found as ChallengeOf<T>
}

export const DISPLAY: ChallengeDisplay = {
  transliteration: false,
  vowelMarks: false,
  sound: false,
  reducedMotion: false,
}

export function verdictOf(
  challenge: Challenge,
  response: ChallengeResponse | null,
): Verdict | null {
  return response === null ? null : gradeResponse(challenge, response).verdict
}

interface HarnessProps {
  challenge: Challenge
  phase: 'answering' | 'feedback'
  verdict: Verdict | null
  display: ChallengeDisplay
  audio: ChallengeAudio
  initial: ChallengeResponse | null
  onResponse(r: ChallengeResponse | null): void
  onSubmit(): void
  onMismatch(): void
}

function Harness({ challenge, initial, onResponse, ...rest }: HarnessProps) {
  const [response, setResponse] = useState<ChallengeResponse | null>(initial)
  const Renderer = renderers[challenge.type as keyof typeof renderers] as ChallengeRenderer
  return (
    <Renderer
      {...rest}
      challenge={challenge}
      response={response}
      onResponse={(r) => {
        setResponse(r)
        onResponse(r)
      }}
    />
  )
}

export interface RenderOptions {
  display?: Partial<ChallengeDisplay>
  phase?: 'answering' | 'feedback'
  /** Initial draft (e.g. to render a graded feedback state directly). */
  response?: ChallengeResponse | null
}

/** Renders a challenge through `renderers` (the real map the player uses). */
export function renderChallenge(challenge: Challenge, opts: RenderOptions = {}) {
  const user = userEvent.setup()
  const onResponse = vi.fn<(r: ChallengeResponse | null) => void>()
  const onSubmit = vi.fn<() => void>()
  const onMismatch = vi.fn<() => void>()
  const audio = {
    play: vi.fn<ChallengeAudio['play']>(),
    stop: vi.fn<ChallengeAudio['stop']>(),
    mouthOpen: vi.fn<ChallengeAudio['mouthOpen']>(() => 0),
  }
  const display = { ...DISPLAY, ...opts.display }
  const initial = opts.response ?? null
  const phase = opts.phase ?? 'answering'
  const element = (p: 'answering' | 'feedback', verdict: Verdict | null): ReactElement => (
    <Harness
      challenge={challenge}
      phase={p}
      verdict={verdict}
      display={display}
      audio={audio}
      initial={initial}
      onResponse={onResponse}
      onSubmit={onSubmit}
      onMismatch={onMismatch}
    />
  )
  const utils = render(element(phase, phase === 'feedback' ? verdictOf(challenge, initial) : null))
  /** The latest draft the renderer reported (null when none or cleared). */
  const last = (): ChallengeResponse | null => onResponse.mock.lastCall?.[0] ?? null
  return {
    ...utils,
    user,
    audio,
    onResponse,
    onSubmit,
    onMismatch,
    last,
    /** Grades the latest draft like the player's CHECK. */
    verdict: () => verdictOf(challenge, last()),
    /** Moves to the feedback phase with the latest draft graded (state is kept). */
    check: () => utils.rerender(element('feedback', verdictOf(challenge, last()))),
  }
}

/** Matches an accessible name that starts with `text` (graded cards append ", correct"/", incorrect"). */
export function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
}

/**
 * A labelled group is English (its name is read with an English voice); returns the Persian
 * content inside it, which must carry lang="fa" dir="rtl" itself.
 */
export function persianOf(group: HTMLElement): HTMLElement {
  expect(group).toHaveAttribute('lang', 'en')
  const fa = group.querySelector<HTMLElement>('[lang="fa"]')
  expect(fa).not.toBeNull()
  expect(fa).toHaveAttribute('dir', 'rtl')
  return fa!
}

/** Presses Tab (keyboard only, like a learner) until `el` has focus; fails after 40 presses. */
export async function tabTo(user: UserEvent, el: HTMLElement): Promise<void> {
  for (let i = 0; i < 40 && document.activeElement !== el; i++) await user.tab()
  expect(el).toHaveFocus()
}
