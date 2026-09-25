'use client'
import { FaText, FeedbackBar } from '@zaboon/ui'
import type { Verdict } from '@zaboon/contracts'
import type { Solution } from '../../lib/lesson/grading'

const PRAISE = ['Nice!', 'Great job!', 'Excellent!', 'Amazing!', 'Well done!', 'Correct!'] as const

/** A cheerful title for a correct answer (varies by attempt, stable across re-renders). */
export function praiseFor(seed: number): string {
  return PRAISE[Math.abs(seed) % PRAISE.length]!
}

export interface LessonFeedbackProps {
  verdict: Verdict
  attemptSeq: number
  solution: Solution | null
  onContinue: () => void
  onReport: () => void
}

function SolutionText({ solution }: { solution: Solution }) {
  return solution.lang === 'fa' ? (
    <FaText text={solution.text} size="md" />
  ) : (
    <span lang="en">{solution.text}</span>
  )
}

/**
 * The feedback bar after CHECK (DESIGN-SYSTEM §2.2): correct → praise; typo/spelling → accepted with
 * a note and the right spelling; wrong or skipped → "Correct solution:" and the report flag.
 */
export function LessonFeedback({
  verdict,
  attemptSeq,
  solution,
  onContinue,
  onReport,
}: LessonFeedbackProps) {
  const correct = verdict === 'correct' || verdict === 'typo' || verdict === 'spelling'
  if (correct) {
    const note =
      verdict === 'typo'
        ? 'You have a typo.'
        : verdict === 'spelling'
          ? 'Watch the spelling.'
          : null
    return (
      <div data-testid="lesson-feedback" data-verdict={verdict}>
        <FeedbackBar
          status="correct"
          title={praiseFor(attemptSeq)}
          solution={note && solution ? <SolutionText solution={solution} /> : undefined}
          detail={note ?? undefined}
          onContinue={onContinue}
          onReport={onReport}
        />
      </div>
    )
  }
  return (
    <div data-testid="lesson-feedback" data-verdict={verdict}>
      <FeedbackBar
        status="wrong"
        title={solution ? 'Correct solution:' : verdict === 'skipped' ? 'Skipped' : 'Not quite'}
        solution={solution ? <SolutionText solution={solution} /> : undefined}
        detail={verdict === 'skipped' ? "We'll come back to this one." : undefined}
        onContinue={onContinue}
        onReport={onReport}
      />
    </div>
  )
}
