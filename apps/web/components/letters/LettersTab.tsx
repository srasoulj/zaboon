'use client'
/**
 * The Letters tab (DESIGN-SYSTEM §2.3, LEARNING-ENGINE §2.2): the alphabet grid in `order` with a
 * 4-step mastery bar under each letter (tap to hear it), a "Learn the letters" CTA to the current
 * letters lesson, and the lessons in teaching order.
 */
import clsx from 'clsx'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LettersResponse } from '@zaboon/contracts'
import { FaText, Icon } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { playAudio } from '../path/play-audio'
import {
  ctaLesson,
  lessonLetters,
  lessonStateLabel,
  lettersLessonHref,
  type LetterData,
  type LetterLesson,
} from './letters-model'
import { StrengthBars } from './StrengthBars'
import styles from './letters.module.css'

export function LettersTab() {
  const api = useApi()
  const session = useSession()
  const signedIn = session.status === 'signed_in'
  const home = useHome(signedIn)
  const letters = useQuery<LettersResponse>({
    queryKey: queryKeys.letters,
    queryFn: () => api('letters'),
    enabled: signedIn,
  })
  const courseId = home.data?.course.id ?? null

  return (
    <section aria-labelledby="letters-title" className={styles.page}>
      <header>
        <h1 id="letters-title" className={styles.title}>
          Letters
        </h1>
        <p className={styles.lead}>Get to know the Persian alphabet: see it, hear it, read it.</p>
      </header>
      {letters.data ? (
        <LettersContent data={letters.data} courseId={courseId} />
      ) : letters.isError ? (
        <p className={styles.status} role="alert">
          We couldn&apos;t load the letters.
        </p>
      ) : (
        <p className={styles.status} role="status">
          Loading the letters…
        </p>
      )}
    </section>
  )
}

export function LettersContent({
  data,
  courseId,
}: {
  data: LettersResponse
  courseId: string | null
}) {
  const next = ctaLesson(data.lessons)
  return (
    <>
      {next && courseId && (
        <Link
          href={lettersLessonHref(courseId, next.id)}
          className={clsx('btn-3d zb-btn zb-btn--primary zb-btn--full', styles.cta)}
          data-testid="letters-cta"
        >
          <span className="zb-btn__label">Learn the letters</span>
        </Link>
      )}

      <section aria-labelledby="alphabet-title">
        <h2 id="alphabet-title" className={styles.heading}>
          The alphabet
        </h2>
        <ul className={styles.grid} data-testid="letters-grid">
          {data.letters.map((l) => (
            <li key={l.id}>
              <LetterTile letter={l} />
            </li>
          ))}
        </ul>
      </section>

      {data.lessons.length > 0 && (
        <section aria-labelledby="letter-lessons-title">
          <h2 id="letter-lessons-title" className={styles.heading}>
            Lessons
          </h2>
          <ol className={styles.lessons}>
            {data.lessons.map((lesson, i) => (
              <LessonItem
                key={lesson.id}
                lesson={lesson}
                index={i}
                letters={lessonLetters(lesson, data.letters)}
                courseId={courseId}
              />
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

function LetterTile({ letter }: { letter: LetterData }) {
  const body = (
    <>
      <FaText text={letter.letter} size="xl" className={styles.glyph} />
      <span className={styles.translit}>{letter.translit}</span>
      <span className="sr-only">
        {letter.name}
        {letter.introduced ? '' : ', not learned yet'}
      </span>
      <StrengthBars strength={letter.strength} />
    </>
  )
  const common = {
    className: clsx(styles.tile, !letter.introduced && styles.dim),
    'data-letter': letter.id,
    'data-introduced': String(letter.introduced),
  }
  const audio = letter.audio
  return audio ? (
    <button type="button" {...common} onClick={() => playAudio(audio)}>
      {body}
    </button>
  ) : (
    <div {...common}>{body}</div>
  )
}

function LessonItem({
  lesson,
  index,
  letters,
  courseId,
}: {
  lesson: LetterLesson
  index: number
  letters: string[]
  courseId: string | null
}) {
  const playable = lesson.state !== 'locked' && courseId !== null
  const done = lesson.state === 'completed' || lesson.state === 'legendary'
  return (
    <li className={styles.lesson} data-state={lesson.state} data-lesson={lesson.id}>
      <span className={styles.lessonIcon} aria-hidden="true">
        <Icon name={done ? 'check' : lesson.state === 'locked' ? 'lock' : 'star'} size={22} />
      </span>
      <span className={styles.lessonText}>
        <span className={styles.lessonTitle}>
          {index + 1}. {lesson.title}
        </span>
        {letters.length > 0 && (
          <span className={styles.lessonLetters}>
            {letters.map((ch, i) => (
              <FaText key={`${ch}-${i}`} text={ch} size="md" />
            ))}
          </span>
        )}
        <span className={styles.lessonState}>{lessonStateLabel(lesson.state)}</span>
      </span>
      {playable && (
        <Link
          href={lettersLessonHref(courseId, lesson.id)}
          className={clsx(
            styles.lessonLink,
            lesson.state === 'current' && styles.lessonLinkPrimary,
          )}
          aria-label={`${done ? 'Replay' : 'Start'}: ${lesson.title}`}
        >
          {done ? 'Replay' : 'Start'}
        </Link>
      )}
    </li>
  )
}
