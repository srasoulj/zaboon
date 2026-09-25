'use client'
import { Button3D } from '@zaboon/ui'

export interface LessonFooterProps {
  /** CHECK is grey (locked) until the renderer reports a response. */
  canCheck: boolean
  onCheck: () => void
  onSkip: () => void
}

/** The answering footer (DESIGN-SYSTEM §2.2): SKIP and CHECK. */
export function LessonFooter({ canCheck, onCheck, onSkip }: LessonFooterProps) {
  return (
    <footer className="border-t-2 border-line px-4 py-5" data-testid="lesson-footer">
      <div className="mx-auto flex max-w-[640px] items-center justify-between gap-4">
        <Button3D variant="ghost" onClick={onSkip} data-testid="lesson-skip">
          Skip
        </Button3D>
        <Button3D
          variant={canCheck ? 'primary' : 'locked'}
          onClick={onCheck}
          data-testid="lesson-check"
          className="min-w-[150px]"
        >
          Check
        </Button3D>
      </div>
    </footer>
  )
}
