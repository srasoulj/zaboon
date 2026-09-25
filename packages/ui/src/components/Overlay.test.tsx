import '../test-utils'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider } from '../motion-preference'
import { Button3D } from './Button3D'
import { BottomSheet, Modal, Toast } from './Overlay'

function ModalHarness({ sheet = false, dismissible }: { sheet?: boolean; dismissible?: boolean }) {
  const [open, setOpen] = useState(false)
  const stay = useRef<HTMLButtonElement>(null)
  const Comp = sheet ? BottomSheet : Modal
  return (
    <MotionPreferenceProvider reduce>
      <button onClick={() => setOpen(true)}>Open</button>
      <Comp
        open={open}
        onClose={() => setOpen(false)}
        title="Wait, don't go!"
        description="You'll lose your progress."
        dismissible={dismissible}
        initialFocus={stay}
        actions={
          <>
            <Button3D ref={stay} onClick={() => setOpen(false)}>
              Keep learning
            </Button3D>
            <Button3D variant="ghost">End session</Button3D>
          </>
        }
      />
    </MotionPreferenceProvider>
  )
}

describe.each([
  ['Modal', false],
  ['BottomSheet', true],
] as const)('%s', (_name, sheet) => {
  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('is a labelled, described modal dialog that takes focus and locks scroll', async () => {
    render(<ModalHarness sheet={sheet} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: "Wait, don't go!" })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription("You'll lose your progress.")
    expect(screen.getByRole('button', { name: 'Keep learning' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('traps Tab inside and closes on Escape, restoring focus to the opener', async () => {
    render(<ModalHarness sheet={sheet} />)
    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    await user.tab()
    expect(screen.getByRole('button', { name: 'End session' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'End session' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes from the close button and the backdrop unless not dismissible', async () => {
    const { unmount } = render(<ModalHarness sheet={sheet} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByTestId('overlay-backdrop'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()

    render(<ModalHarness sheet={sheet} dismissible={false} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByTestId('overlay-backdrop'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    render(<ModalHarness sheet={sheet} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses role=status for info/success and role=alert for errors, with an icon', () => {
    const { rerender } = render(<Toast message="Saved" tone="success" duration={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('status').querySelector('[data-icon="check"]')).not.toBeNull()
    rerender(<Toast message="Offline" tone="error" duration={null} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Offline')
  })

  it('auto-dismisses after the duration, pausing while hovered', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<Toast message="Hi" onDismiss={onDismiss} duration={1000} />)
    act(() => {
      screen.getByRole('status').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      screen.getByRole('status').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    })
    act(() => vi.advanceTimersByTime(999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('can be dismissed with its button', async () => {
    const onDismiss = vi.fn()
    render(<Toast message="Hi" onDismiss={onDismiss} duration={null} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
