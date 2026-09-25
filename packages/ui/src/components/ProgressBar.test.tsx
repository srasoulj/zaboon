import '../test-utils'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { clamp01, ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('exposes progress as a percentage', () => {
    render(<ProgressBar value={0.426} />)
    const bar = screen.getByRole('progressbar', { name: 'Lesson progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '43')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar.querySelector('.zb-progress__fill')).toHaveStyle({ inlineSize: '43%' })
    expect(bar.querySelector('.zb-progress__stripe')).not.toBeNull()
  })

  it('clamps out-of-range and non-finite values', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    render(<ProgressBar value={3} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('glows with an "N in a row" badge from the threshold', () => {
    const { container, rerender } = render(<ProgressBar value={0.5} streak={2} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.firstElementChild).not.toHaveClass('zb-progress--glow')
    rerender(<ProgressBar value={0.5} streak={5} />)
    expect(screen.getByRole('status')).toHaveTextContent('5 in a row')
    expect(container.firstElementChild).toHaveClass('zb-progress--glow')
  })
})
