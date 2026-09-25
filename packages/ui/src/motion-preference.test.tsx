import './test-utils'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider, usePrefersReducedMotion } from './motion-preference'

function Probe() {
  return <span>{usePrefersReducedMotion() ? 'reduce' : 'full'}</span>
}

function mockMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }))
  return (next: boolean) => {
    matches = next
    listeners.forEach((l) => l())
  }
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false without matchMedia (SSR, jsdom)', () => {
    render(<Probe />)
    expect(screen.getByText('full')).toBeInTheDocument()
  })

  it('follows the OS setting and its changes', () => {
    const set = mockMatchMedia(true)
    render(<Probe />)
    expect(screen.getByText('reduce')).toBeInTheDocument()
    act(() => set(false))
    expect(screen.getByText('full')).toBeInTheDocument()
  })

  it('the in-app toggle forces reduced motion', () => {
    mockMatchMedia(false)
    render(
      <MotionPreferenceProvider reduce>
        <Probe />
      </MotionPreferenceProvider>,
    )
    expect(screen.getByText('reduce')).toBeInTheDocument()
  })
})
