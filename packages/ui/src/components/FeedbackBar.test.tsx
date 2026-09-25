import '../test-utils'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FaText } from './FaText'
import { FeedbackBar } from './FeedbackBar'

describe('FeedbackBar', () => {
  it('correct: announces "Nice!" in a live region with an icon and a primary CONTINUE', () => {
    render(<FeedbackBar status="correct" onContinue={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Nice!')
    expect(screen.getByRole('alert').querySelector('svg[data-icon="check"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('zb-btn--primary')
    expect(screen.getByRole('region', { name: 'Correct answer' })).toHaveAttribute('data-status', 'correct')
  })

  it('wrong: shows the solution slot, the report flag and a danger CONTINUE', async () => {
    const onReport = vi.fn()
    render(
      <FeedbackBar status="wrong" solution={<FaText text="من آب می‌خوام" />} onContinue={() => {}} onReport={onReport} />,
    )
    expect(screen.getByRole('heading', { name: 'Correct solution:' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('من آب می‌خوام')
    expect(screen.getByRole('alert').querySelector('[lang="fa"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('zb-btn--danger')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(onReport).toHaveBeenCalledOnce()
  })

  it('focuses CONTINUE so Enter continues', async () => {
    const onContinue = vi.fn()
    render(<FeedbackBar status="correct" onContinue={onContinue} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
    await userEvent.setup().keyboard('{Enter}')
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('can skip autofocus and customize copy', () => {
    render(<FeedbackBar status="correct" title="Great job!" continueLabel="Next" autoFocus={false} detail="water" onContinue={() => {}} />)
    expect(screen.getByRole('button', { name: 'Next' })).not.toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Great job!water')
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull()
  })
})
