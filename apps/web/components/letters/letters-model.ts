/** Pure helpers for the Letters tab (GET /api/letters). */
import type { LettersResponse } from '@zaboon/contracts'
import { lessonHref } from '@/lib/lesson/request'

export type LetterData = LettersResponse['letters'][number]
export type LetterLesson = LettersResponse['lessons'][number]

/**
 * The lesson "Learn the letters" opens: the current one, else (every lesson done) the last
 * completed one to replay, else the first unlocked one. Null when nothing can be played.
 */
export function ctaLesson(lessons: readonly LetterLesson[]): LetterLesson | null {
  const current = lessons.find((l) => l.state === 'current')
  if (current) return current
  const done = lessons.filter((l) => l.state === 'completed' || l.state === 'legendary')
  if (done.length > 0) return done[done.length - 1]!
  return lessons.find((l) => l.state === 'available') ?? null
}

/** The player URL for a letters lesson. */
export function lettersLessonHref(courseId: string, lessonId: string): string {
  return lessonHref({ courseId, kind: 'letters', levelId: lessonId })
}

const STATE_LABELS: Record<LetterLesson['state'], string> = {
  current: 'Up next',
  completed: 'Completed',
  legendary: 'Legendary',
  available: 'Unlocked',
  locked: 'Locked',
}

export function lessonStateLabel(state: LetterLesson['state']): string {
  return STATE_LABELS[state]
}

/** The Persian letters a lesson teaches, from its letter ids (unknown ids are skipped). */
export function lessonLetters(lesson: LetterLesson, letters: readonly LetterData[]): string[] {
  const byId = new Map(letters.map((l) => [l.id, l.letter]))
  return lesson.letters.flatMap((id) => {
    const letter = byId.get(id)
    return letter ? [letter] : []
  })
}
