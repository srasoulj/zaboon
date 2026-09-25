import '../test-utils'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button3D } from './Button3D'

describe('Button3D', () => {
  it('renders an accessible button with the 3D recipe class and variant', () => {
    render(<Button3D variant="danger">Quit</Button3D>)
    const btn = screen.getByRole('button', { name: 'Quit' })
    expect(btn).toHaveClass('btn-3d', 'zb-btn--danger')
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).not.toHaveAttribute('aria-disabled')
  })

  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)('%s calls onClick on click, Enter and Space', async (variant) => {
    const onClick = vi.fn()
    render(
      <Button3D variant={variant} onClick={onClick}>
        Check
      </Button3D>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('locked is aria-disabled, focusable and ignores clicks', async () => {
    const onClick = vi.fn()
    render(
      <Button3D variant="locked" onClick={onClick}>
        Check
      </Button3D>,
    )
    const btn = screen.getByRole('button', { name: 'Check' })
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    const user = userEvent.setup()
    await user.tab()
    expect(btn).toHaveFocus()
    await user.click(btn)
    await user.keyboard('{Enter}')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading keeps the label, sets aria-busy and ignores clicks', async () => {
    const onClick = vi.fn()
    render(
      <Button3D loading onClick={onClick}>
        Save
      </Button3D>,
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup().click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('native disabled is not focusable', async () => {
    render(<Button3D disabled>Nope</Button3D>)
    await userEvent.setup().tab()
    expect(screen.getByRole('button')).not.toHaveFocus()
  })

  it('forwards ref and extra props', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(
      <Button3D ref={ref} fullWidth data-testid="b" type="submit">
        Go
      </Button3D>,
    )
    expect(ref.current).toBe(screen.getByTestId('b'))
    expect(ref.current).toHaveAttribute('type', 'submit')
    expect(ref.current).toHaveClass('zb-btn--full')
  })
})
