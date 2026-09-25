'use client'
import { useRef } from 'react'
import { Button3D, Character, Modal } from '@zaboon/ui'

/** "Wait, don't go!" (DESIGN-SYSTEM §2.3): Escape or the close button asks before quitting. */
export function QuitDialog({ open, onStay, onQuit }: { open: boolean; onStay: () => void; onQuit: () => void }) {
  const stay = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      open={open}
      onClose={onStay}
      initialFocus={stay}
      title="Wait, don't go!"
      description="You'll lose your progress in this lesson if you quit now."
      illustration={<Character name="hodhod" mood="sad" size={96} decorative />}
      actions={
        <>
          <Button3D ref={stay} onClick={onStay} fullWidth data-testid="quit-stay">
            Keep learning
          </Button3D>
          <Button3D variant="ghost" onClick={onQuit} fullWidth data-testid="quit-confirm">
            End session
          </Button3D>
        </>
      }
    />
  )
}

/** Out of hearts: practice to earn one back, or leave. */
export function OutOfHeartsModal({
  open,
  onPractice,
  onQuit,
}: {
  open: boolean
  onPractice: () => void
  onQuit: () => void
}) {
  const practice = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      open={open}
      onClose={onQuit}
      dismissible={false}
      initialFocus={practice}
      title="You ran out of hearts"
      description="Practice to earn a heart back, or come back when your hearts refill."
      illustration={<Character name="hodhod" mood="sad" size={96} decorative />}
      actions={
        <>
          <Button3D ref={practice} variant="secondary" onClick={onPractice} fullWidth data-testid="hearts-practice">
            Practice to earn hearts
          </Button3D>
          <Button3D variant="ghost" onClick={onQuit} fullWidth data-testid="hearts-quit">
            No thanks
          </Button3D>
        </>
      }
    />
  )
}
