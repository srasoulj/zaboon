'use client'
/**
 * The Practice page (LEARNING-ENGINE §8): one START into a practice session (no hearts spent, one
 * earned back) and the learner's words with their strength, due first. With `flags.practiceHub`
 * (P2) the START becomes the practice hub: mode cards from GET /api/practice, each opening
 * `/lesson?course=…&kind=practice&mode=<mode>`. With the flag off the page is the MVP's.
 */
import clsx from 'clsx'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { PracticeMode, PracticeResponse, WordsResponse } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { lessonHref } from '@/lib/lesson/request'
import { StrengthBars } from '../letters/StrengthBars'
import { playAudio } from '../path/play-audio'
import styles from './practice.module.css'

export type WordData = WordsResponse['words'][number]

export function practiceHref(courseId: string, mode?: PracticeMode): string {
  return lessonHref({
    courseId,
    kind: 'practice',
    levelId: null,
    ...(mode === undefined ? {} : { mode }),
  })
}

export function PracticeHub() {
  const api = useApi()
  const session = useSession()
  const signedIn = session.status === 'signed_in'
  const home = useHome(signedIn)
  const words = useQuery<WordsResponse>({
    queryKey: queryKeys.words,
    queryFn: () => api('words'),
    enabled: signedIn,
    // A finished lesson changes word strengths, and the player doesn't invalidate this key.
    refetchOnMount: 'always',
  })
  const courseId = home.data?.course.id
  const hub = home.data?.flags.practiceHub === true

  return (
    <section aria-labelledby="practice-title" className={styles.page}>
      {hub ? <PracticeModes /> : <PracticeStart courseId={courseId} />}

      <section aria-labelledby="words-title">
        <h2 id="words-title" className={styles.heading}>
          Your words
        </h2>
        {words.data ? (
          <WordList words={words.data.words} />
        ) : words.isError ? (
          <p className={styles.status} role="alert">
            We couldn&apos;t load your words.
          </p>
        ) : (
          <p className={styles.status} role="status">
            Loading your words…
          </p>
        )}
      </section>
    </section>
  )
}

function PracticeStart({ courseId }: { courseId: string | undefined }) {
  return (
    <header className={styles.hero}>
      <h1 id="practice-title" className={styles.title}>
        Practice
      </h1>
      <p className={styles.lead}>
        Review the words you&apos;ve learned. Practice costs no hearts and earns one back.
      </p>
      {courseId ? (
        <Link
          href={practiceHref(courseId)}
          className={clsx('btn-3d zb-btn zb-btn--primary zb-btn--full', styles.linkButton)}
          data-testid="practice-start"
        >
          <span className="zb-btn__label">Start</span>
        </Link>
      ) : (
        <span
          className="btn-3d zb-btn zb-btn--locked zb-btn--full"
          aria-disabled="true"
          data-variant="locked"
        >
          <span className="zb-btn__label">Start</span>
        </span>
      )}
    </header>
  )
}

const MODES: Record<PracticeMode, { title: string; body: string }> = {
  mixed: { title: 'Mixed review', body: 'A bit of everything, due words first.' },
  mistakes: { title: 'Mistakes', body: 'Go over the things you got wrong.' },
  listening: { title: 'Listening', body: 'Train your ear with audio challenges.' },
  typing: { title: 'Typing', body: 'Type your answers in Persian.' },
}

/** P2 practice hub: one card per mode, with its count and whether it can start now. */
function PracticeModes() {
  const api = useApi()
  const practice = useQuery<PracticeResponse>({
    queryKey: queryKeys.practice,
    queryFn: () => api('practice'),
    refetchOnMount: 'always',
  })
  return (
    <header className={styles.hero} data-testid="practice-hub">
      <h1 id="practice-title" className={styles.title}>
        Practice
      </h1>
      <p className={styles.lead}>Pick a practice. It costs no hearts and earns one back.</p>
      {practice.data ? (
        <ul className={styles.modes}>
          {practice.data.modes.map((m) => {
            const meta = MODES[m.mode]
            const label = (
              <>
                <span className={styles.modeTitle}>{meta.title}</span>
                <span className={styles.modeBody}>{meta.body}</span>
                {m.count !== null && (
                  <span className={styles.modeCount}>
                    {m.mode === 'mistakes' ? `${m.count} to review` : `${m.count} due`}
                  </span>
                )}
              </>
            )
            return (
              <li key={m.mode} data-testid="practice-mode" data-mode={m.mode}>
                {m.available ? (
                  <Link
                    href={practiceHref(practice.data.courseId, m.mode)}
                    className={clsx('card-3d', styles.mode)}
                  >
                    {label}
                  </Link>
                ) : (
                  <span
                    className={clsx('card-3d', styles.mode, styles.modeLocked)}
                    aria-disabled="true"
                  >
                    {label}
                    <span className={styles.modeCount}>Not available yet</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : practice.isError ? (
        <p className={styles.status} role="alert">
          We couldn&apos;t load the practice modes.
        </p>
      ) : (
        <p className={styles.status} role="status">
          Loading practice…
        </p>
      )}
    </header>
  )
}

export function WordList({ words }: { words: readonly WordData[] }) {
  if (words.length === 0)
    return (
      <p className={styles.empty} data-testid="words-empty">
        No words yet. Finish a lesson and the words you learn show up here.
      </p>
    )
  return (
    <ul className={styles.words} data-testid="words-list">
      {words.map((w) => (
        <li key={w.lexemeId} className={styles.word} data-lexeme={w.lexemeId}>
          <span className={styles.wordText}>
            <FaText text={w.fa} size="lg" />
            <span className={styles.translit}>{w.translit}</span>
          </span>
          <span className={styles.gloss}>{w.gloss}</span>
          <StrengthBars strength={w.strength} />
          {w.audio && (
            <button
              type="button"
              className={styles.listen}
              aria-label={`Listen: ${w.gloss || w.translit}`}
              onClick={() => playAudio(w.audio!)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                <path
                  d="M16.5 8.5a5 5 0 010 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
