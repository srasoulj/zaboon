import '../test-utils'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ChoiceCard, useDigitShortcuts } from './ChoiceCard'

function Group({ onPick }: { onPick?: (n: number) => void }) {
  const [sel, setSel] = useState<number | null>(null)
  const options = ['water', 'bread', 'tea']
  useDigitShortcuts(options.length, (n) => {
    setSel(n)
    onPick?.(n)
  })
  return (
    <div>
      {options.map((o, i) => (
        <ChoiceCard key={o} index={i + 1} selected={sel === i + 1} onSelect={() => setSel(i + 1)}>
          {o}
        </ChoiceCard>
      ))}
      <input aria-label="free text" />
    </div>
  )
}

describe('ChoiceCard', () => {
  it('shows the 1–9 hint and exposes aria-pressed + aria-keyshortcuts', () => {
    render(
      <ChoiceCard index={3} selected>
        tea
      </ChoiceCard>,
    )
    const card = screen.getByRole('button', { name: 'tea' })
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveAttribute('aria-keyshortcuts', '3')
    expect(card.querySelector('kbd')).toHaveTextContent('3')
    expect(card.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true')
  })

  it('hides the hint outside 1–9', () => {
    render(<ChoiceCard index={10}>x</ChoiceCard>)
    expect(screen.getByRole('button').querySelector('kbd')).toBeNull()
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-keyshortcuts')
  })

  it('selects on click and on keyboard activation', async () => {
    render(<Group />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'bread' }))
    expect(screen.getByRole('button', { name: 'bread' })).toHaveAttribute('aria-pressed', 'true')
    screen.getByRole('button', { name: 'tea' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'tea' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'bread' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('digit keys pick an option; out-of-range, modified and typing keys are ignored', async () => {
    const onPick = vi.fn()
    render(<Group onPick={onPick} />)
    const user = userEvent.setup()
    await user.keyboard('2')
    expect(screen.getByRole('button', { name: 'bread' })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('7')
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true })
    await user.type(screen.getByRole('textbox'), '1')
    expect(onPick).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: '۱', code: 'Digit1' })
    expect(onPick).toHaveBeenLastCalledWith(1)
  })

  it('announces graded state with text, not color alone', () => {
    render(
      <ChoiceCard state="wrong" selected>
        bread
      </ChoiceCard>,
    )
    expect(screen.getByRole('button')).toHaveAccessibleName('bread, incorrect')
    expect(screen.getByRole('button')).toHaveAttribute('data-state', 'wrong')
  })

  it('does not fire when disabled', async () => {
    const onSelect = vi.fn()
    render(
      <ChoiceCard disabled onSelect={onSelect}>
        x
      </ChoiceCard>,
    )
    await userEvent.setup().click(screen.getByRole('button'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
