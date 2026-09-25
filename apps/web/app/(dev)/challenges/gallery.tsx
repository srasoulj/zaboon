'use client'
import type { Challenge, ChallengeResponse, Verdict } from '@zaboon/contracts'
import { gradeResponse } from '@zaboon/session-engine'
import { Button3D, MotionPreferenceProvider } from '@zaboon/ui'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { correctResponse, wrongResponse } from '@/components/challenges/fixtures/samples'
import {
  rendererFor,
  type ChallengeAudio,
  type ChallengeDisplay,
  type ChallengeRenderer,
} from '@/lib/challenge-registry'
import styles from './challenges.module.css'

export interface GalleryEntry {
  /** `<type>-<n>`, e.g. `translate_bank-1`. */
  id: string
  challenge: Challenge
}

const fileName = (url: string) => url.split('/').pop() ?? url

/** Stand-in for the player's audio service: records what would play (the gallery has no media). */
function useFakeAudio(): { audio: ChallengeAudio; played: string | null } {
  const [played, setPlayed] = useState<string | null>(null)
  const audio = useMemo<ChallengeAudio>(
    () => ({
      play: (url, opts) => setPlayed(`${fileName(url)}${opts?.slow ? ' (slow)' : ''}`),
      stop: () => setPlayed(null),
      mouthOpen: () => 0,
    }),
    [],
  )
  return { audio, played }
}

/** A miniature player: holds the draft, CHECK grades it with gradeResponse, CONTINUE resets. */
function Interactive({ challenge, display }: { challenge: Challenge; display: ChallengeDisplay }) {
  const Renderer = rendererFor(challenge.type) as ChallengeRenderer
  const [round, setRound] = useState(0)
  const [response, setResponse] = useState<ChallengeResponse | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [mismatches, setMismatches] = useState(0)
  const { audio, played } = useFakeAudio()
  const phase = verdict === null ? 'answering' : 'feedback'
  const check = () => {
    if (response !== null && verdict === null)
      setVerdict(gradeResponse(challenge, response).verdict)
  }
  const reset = () => {
    setResponse(null)
    setVerdict(null)
    setMismatches(0)
    setRound((r) => r + 1)
  }
  return (
    <>
      <Renderer
        key={round}
        challenge={challenge}
        response={response}
        onResponse={setResponse}
        onSubmit={check}
        phase={phase}
        verdict={verdict}
        display={display}
        audio={audio}
        onMismatch={() => setMismatches((m) => m + 1)}
      />
      <div className={styles.footer}>
        <p className={styles.status} role="status" data-testid="gallery-status">
          {verdict !== null
            ? `Verdict: ${verdict}`
            : response === null
              ? 'No answer yet'
              : 'Answer ready'}
          {mismatches > 0 && ` · mismatches: ${mismatches}`}
          {played !== null && ` · played ${played}`}
        </p>
        {phase === 'answering' ? (
          <Button3D variant={response === null ? 'locked' : 'primary'} onClick={check}>
            Check
          </Button3D>
        ) : (
          <Button3D onClick={reset}>Continue</Button3D>
        )}
      </div>
    </>
  )
}

/** A graded screen: the sample wrong answer (or the only possible one for matching/intro). */
function Feedback({ challenge, display }: { challenge: Challenge; display: ChallengeDisplay }) {
  const Renderer = rendererFor(challenge.type) as ChallengeRenderer
  const { audio } = useFakeAudio()
  const response =
    challenge.type === 'letter_intro' ? correctResponse(challenge) : wrongResponse(challenge)
  const verdict = gradeResponse(challenge, response).verdict
  const noop = () => {}
  return (
    <Renderer
      challenge={challenge}
      response={response}
      onResponse={noop}
      onSubmit={noop}
      phase="feedback"
      verdict={verdict}
      display={display}
      audio={audio}
      onMismatch={noop}
    />
  )
}

export interface ChallengeGalleryProps {
  entries: readonly GalleryEntry[]
  ids: readonly string[]
  /** The P2 subset of `ids` (their links and options sit after the MVP challenges). */
  p2Ids: readonly string[]
  theme: 'light' | 'dark'
  reduceMotion: boolean
  single: boolean
}

export function ChallengeGallery({
  entries,
  ids,
  p2Ids,
  theme,
  reduceMotion,
  single,
}: ChallengeGalleryProps) {
  const [ready, setReady] = useState(false)
  const [transliteration, setTransliteration] = useState(true)
  const [vowelMarks, setVowelMarks] = useState(false)
  const [sound, setSound] = useState(false)
  const [persianKeyboard, setPersianKeyboard] = useState(true)
  const [phonetic, setPhonetic] = useState(false)
  // Marks hydration as done so screenshot tests never capture the server-only render.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration flag
  useEffect(() => setReady(true), [])
  const display: ChallengeDisplay = {
    transliteration,
    vowelMarks,
    sound,
    reducedMotion: reduceMotion,
    persianKeyboard,
    keyboardLayout: phonetic ? 'phonetic' : 'standard',
  }
  const toggles: [string, boolean, (v: boolean) => void][] = [
    ['Transliteration', transliteration, setTransliteration],
    ['Vowel marks', vowelMarks, setVowelMarks],
    ['Autoplay audio', sound, setSound],
  ]
  const p2Toggles: [string, boolean, (v: boolean) => void][] = [
    ['In-app Persian keyboard', persianKeyboard, setPersianKeyboard],
    ['Phonetic layout', phonetic, setPhonetic],
  ]
  const firstP2 = entries.find((e) => p2Ids.includes(e.id))?.id
  const checkboxes = (list: typeof toggles) =>
    list.map(([label, value, set]) => (
      <label key={label}>
        <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
      </label>
    ))
  const themeLink = (t: 'light' | 'dark') => `?theme=${t}${reduceMotion ? '&reduce=1' : ''}`

  return (
    <MotionPreferenceProvider reduce={reduceMotion || undefined}>
      <main className={styles.page} data-ready={ready || undefined}>
        <header className={styles.header}>
          <h1 className={styles.title}>Zaboon challenge gallery</h1>
          <nav className={styles.nav} aria-label="Gallery options">
            <a href={themeLink('light')}>Light</a>
            <a href={themeLink('dark')}>Dark</a>
            {single && <a href={`?theme=${theme}`}>All challenges</a>}
          </nav>
          <div className={styles.nav}>{checkboxes(toggles)}</div>
          {!single && (
            <nav className={styles.nav} aria-label="Challenges">
              {ids
                .filter((id) => !p2Ids.includes(id))
                .map((id) => (
                  <a key={id} href={`?theme=${theme}&only=${id}`}>
                    {id}
                  </a>
                ))}
            </nav>
          )}
        </header>
        {entries.map(({ id, challenge }) => (
          <Fragment key={id}>
            {id === firstP2 && (
              <header className={styles.header}>
                <h2 className={styles.title}>P2: typed Persian and tracing (behind flags)</h2>
                <div className={styles.nav}>{checkboxes(p2Toggles)}</div>
                {!single && (
                  <nav className={styles.nav} aria-label="P2 challenges">
                    {p2Ids.map((p) => (
                      <a key={p} href={`?theme=${theme}&only=${p}`}>
                        {p}
                      </a>
                    ))}
                  </nav>
                )}
              </header>
            )}
            <section className={styles.section} aria-label={id} data-testid={`challenge-${id}`}>
              <p className={styles.sectionTitle}>{id}</p>
              <div className={styles.states}>
                <div className={styles.state} data-testid={`answering-${id}`}>
                  <p className={styles.stateLabel}>Answering</p>
                  <Interactive challenge={challenge} display={display} />
                </div>
                <div className={styles.state} data-testid={`feedback-${id}`}>
                  <p className={styles.stateLabel}>Feedback</p>
                  <Feedback challenge={challenge} display={display} />
                </div>
              </div>
            </section>
          </Fragment>
        ))}
      </main>
    </MotionPreferenceProvider>
  )
}
