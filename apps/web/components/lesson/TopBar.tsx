'use client'
import { Icon, ProgressBar, StatPill } from '@zaboon/ui'
import type { LivesView } from '@zaboon/contracts'

export interface TopBarProps {
  /** 0..1 */
  progress: number
  /** Correct answers in a row; the bar glows from 3. */
  combo: number
  hearts: LivesView | null
  onClose: () => void
}

/** Lesson top bar (DESIGN-SYSTEM §2.2): close (X), progress bar with combo glow, hearts. */
export function TopBar({ progress, combo, hearts, onClose }: TopBarProps) {
  return (
    <header className="flex items-center gap-4 px-4 pt-4 pb-2">
      <button
        type="button"
        onClick={onClose}
        aria-label="Quit lesson"
        data-testid="lesson-close"
        className="rounded-full p-1 text-mist hover:text-stone focus-visible:outline-2 focus-visible:outline-lajvard-500"
      >
        <Icon name="close" size={28} />
      </button>
      <ProgressBar value={progress} streak={combo} streakThreshold={3} className="flex-1" />
      {hearts && (
        <div data-testid="lesson-hearts" data-count={hearts.policy === 'unlimited' ? 'infinite' : hearts.count}>
          <StatPill kind="hearts" value={hearts.policy === 'unlimited' ? 'infinite' : hearts.count} />
        </div>
      )}
    </header>
  )
}
