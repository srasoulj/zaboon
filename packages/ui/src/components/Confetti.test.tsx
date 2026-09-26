import '../test-utils'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider } from '../motion-preference'
import { ConfettiBurst, confettiPieces } from './Confetti'

describe('ConfettiBurst', () => {
  afterEach(() => vi.useRealTimers())

  it('generates deterministic pieces in palette colors', () => {
    expect(confettiPieces(10, 7)).toEqual(confettiPieces(10, 7))
    expect(confettiPieces(10, 7)).not.toEqual(confettiPieces(10, 8))
    for (const p of confettiPieces(12)) expect(p.color).toMatch(/^var\(--color-[a-z]+-500\)$/)
  })

  it('renders decorative pieces and calls onDone after the duration', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const { container } = render(
      <ConfettiBurst fireKey={1} count={12} duration={800} onDone={onDone} />,
    )
    const root = container.querySelector('.zb-confetti')!
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root.children).toHaveLength(12)
    act(() => vi.advanceTimersByTime(799))
    expect(onDone).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('renders nothing when idle', () => {
    const { container } = render(<ConfettiBurst fireKey={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('respects reduced motion: no pieces, onDone immediately', () => {
    const onDone = vi.fn()
    const { container } = render(
      <MotionPreferenceProvider reduce>
        <ConfettiBurst fireKey={3} onDone={onDone} />
      </MotionPreferenceProvider>,
    )
    expect(container.querySelector('.zb-confetti')).toBeNull()
    expect(onDone).toHaveBeenCalledOnce()
  })
})
