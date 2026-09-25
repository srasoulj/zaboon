'use client'
/**
 * The MVP Practice page (LEARNING-ENGINE §8): one START into a practice session (no hearts spent,
 * one earned back) and the learner's words with their strength, due first. The full practice hub
 * is Wave 3 (`flags.practiceHub`).
 */
import clsx from 'clsx'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { WordsResponse } from '@zaboon/contracts'
import { FaText } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { lessonHref } from '@/lib/lesson/request'
import { StrengthBars } from '../letters/StrengthBars'
import { playAudio } from '../path/play-audio'
import styles from './practice.module.css'

export type WordData = WordsResponse['words'][number]

export function practiceHref(courseId: string): string {
  return lessonHref({ courseId, kind: 'practice', levelId: null })
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
  })
  const courseId = home.data?.course.id

  return (
    <section aria-labelledby="practice-title" className={styles.page}>
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
