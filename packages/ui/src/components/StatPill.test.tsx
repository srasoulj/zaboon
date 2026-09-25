import '../test-utils'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StatPill, statLabel } from './StatPill'

describe('StatPill', () => {
  it('builds readable labels', () => {
    expect(statLabel('streak', 12)).toBe('12 day streak')
    expect(statLabel('hearts', 1)).toBe('1 heart')
    expect(statLabel('coins', 250)).toBe('250 coins')
    expect(statLabel('hearts', 'infinite')).toBe('Unlimited hearts')
  })

  it('without a popover it is a labelled image, not a button', () => {
    render(<StatPill kind="coins" value={250} />)
    expect(screen.getByRole('img', { name: '250 coins' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('marks an unextended streak as inactive', () => {
    render(<StatPill kind="streak" value={4} active={false} />)
    expect(screen.getByRole('img', { name: '4 day streak' })).toHaveClass('zb-stat--inactive')
  })

  it('toggles the popover with aria-expanded; Escape closes and restores focus', async () => {
    render(<StatPill kind="hearts" value={5} popover={<p>Full hearts</p>} popoverLabel="Hearts" />)
    const btn = screen.getByRole('button', { name: '5 hearts' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
    const user = userEvent.setup()
    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog', { name: 'Hearts' })
    expect(btn).toHaveAttribute('aria-controls', dialog.id)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(btn).toHaveFocus()
  })

  it('closes on an outside pointer down', async () => {
    render(
      <div>
        <StatPill kind="streak" value={3} popover={<p>Calendar</p>} />
        <p>outside</p>
      </div>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: '3 day streak' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
