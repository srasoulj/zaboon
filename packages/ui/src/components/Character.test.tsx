import '../test-utils'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider } from '../motion-preference'
import {
  Character,
  CHARACTER_MOODS,
  CHARACTER_NAMES,
  RIVE_CONTRACT,
  SpeechBubble,
  type CharacterRendererProps,
} from './Character'
import { FaText } from './FaText'

describe('Character', () => {
  it.each(CHARACTER_NAMES)('%s renders an SVG for every mood with an accessible name', (name) => {
    for (const mood of CHARACTER_MOODS) {
      const { container, unmount } = render(<Character name={name} mood={mood} />)
      const img = screen.getByRole('img')
      expect(img.getAttribute('aria-label')).toMatch(new RegExp(`, ${mood}$`))
      const svg = container.querySelector('svg')!
      expect(svg).toHaveAttribute('data-character', name)
      expect(svg).toHaveAttribute('data-mood', mood)
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      unmount()
    }
  })

  it('opens the mouth proportionally to mouthOpen (clamped)', () => {
    const { container, rerender } = render(<Character name="shirin" mouthOpen={0} />)
    expect(container.querySelector('[data-part="mouth-open"]')).toBeNull()
    rerender(<Character name="shirin" mouthOpen={0.2} />)
    const small = Number(container.querySelector('[data-part="mouth-open"]')!.getAttribute('ry'))
    rerender(<Character name="shirin" mouthOpen={5} />)
    const big = Number(container.querySelector('[data-part="mouth-open"]')!.getAttribute('ry'))
    expect(big).toBeGreaterThan(small)
    expect(big).toBe(7)
  })

  it('hodhod opens its beak and flares or droops its crest by mood', () => {
    const { container, rerender } = render(<Character name="hodhod" mouthOpen={1} mood="happy" />)
    expect(container.querySelector('[data-part="mouth-open"]')).toHaveAttribute('transform', 'rotate(20 86 52)')
    const flared = container.querySelector('[data-part="crest"] > g')!.getAttribute('transform')
    rerender(<Character name="hodhod" mood="sad" />)
    const drooped = container.querySelector('[data-part="crest"] > g')!.getAttribute('transform')
    expect(flared).not.toBe(drooped)
  })

  it('shows a static pose under reduced motion or when paused', () => {
    const { container, rerender } = render(<Character name="kian" />)
    expect(container.querySelector('svg')).toHaveClass('zb-char--animate')
    rerender(<Character name="kian" paused />)
    expect(container.querySelector('svg')).toHaveClass('zb-char--static')
    rerender(
      <MotionPreferenceProvider reduce>
        <Character name="kian" />
      </MotionPreferenceProvider>,
    )
    expect(container.querySelector('svg')).toHaveClass('zb-char--static')
  })

  it('accepts a Rive-style renderer with the same inputs', () => {
    const spy = vi.fn((p: CharacterRendererProps) => <canvas data-mood={RIVE_CONTRACT.mood[p.mood]} />)
    const { container } = render(<Character name="babak" mood="thinking" mouthOpen={0.5} size={80} renderer={spy} />)
    expect(spy.mock.calls[0]![0]).toEqual({ name: 'babak', mood: 'thinking', mouthOpen: 0.5, size: 80, animate: true })
    expect(container.querySelector('canvas')).toHaveAttribute('data-mood', '3')
    expect(RIVE_CONTRACT.stateMachine).toBe('Main')
  })

  it('can be decorative or custom-labelled', () => {
    const { rerender } = render(<Character name="leila" decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    rerender(<Character name="leila" label="Leila the chef" />)
    expect(screen.getByRole('img', { name: 'Leila the chef' })).toBeInTheDocument()
  })
})

describe('SpeechBubble', () => {
  it('renders English or Persian content with a tail side', () => {
    const { container } = render(
      <SpeechBubble tail="end">
        <FaText text="سلام!" />
      </SpeechBubble>,
    )
    expect(container.firstElementChild).toHaveClass('zb-bubble--end')
    expect(container.querySelector('[lang="fa"]')).toHaveTextContent('سلام!')
  })
})
