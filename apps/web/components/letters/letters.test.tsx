/** DOM tests for the Letters tab: grid in order, mastery bars, dimmed letters, audio, CTA, lessons. */
import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithServices, testHome, TEST_LETTERS } from '../path/test-support'
import { LettersTab } from './LettersTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const handlers = { home: () => testHome(), letters: () => TEST_LETTERS }

describe('LettersTab', () => {
  it('makes no request before a session exists', async () => {
    const { calls } = renderWithServices(<LettersTab />, { session: null, handlers })
    await act(async () => {})
    expect(calls).toEqual([])
    expect(screen.getByRole('heading', { level: 1, name: 'Letters' })).toBeInTheDocument()
  })

  it('draws the alphabet in order with strength bars and dims letters not yet introduced', async () => {
    renderWithServices(<LettersTab />, { handlers })
    const grid = await screen.findByTestId('letters-grid')
    const tiles = [...grid.querySelectorAll<HTMLElement>('[data-letter]')]
    expect(tiles.map((t) => t.dataset.letter)).toEqual(['l_alef', 'l_be', 'l_dal'])
    expect(
      tiles.map((t) => t.querySelector('[data-strength]')?.getAttribute('data-strength')),
    ).toEqual(['3', '1', '0'])
    expect(within(tiles[0]!).getByRole('img', { name: 'Strength 3 of 4' })).toBeInTheDocument()
    expect(tiles.map((t) => t.dataset.introduced)).toEqual(['true', 'true', 'false'])
    expect(tiles[2]).toHaveTextContent(/not learned yet/)
    for (const t of tiles) expect(t.querySelector('[lang="fa"]')).toHaveAttribute('dir', 'rtl')
    // Letters with a sound are buttons; the others are not interactive.
    expect(tiles.map((t) => t.tagName)).toEqual(['BUTTON', 'DIV', 'BUTTON'])
  })

  it('plays a letter when tapped', async () => {
    const play = vi.fn(() => Promise.resolve())
    const AudioMock = vi.fn(function (this: { play: typeof play; pause(): void }) {
      this.play = play
      this.pause = () => {}
    })
    vi.stubGlobal('Audio', AudioMock)
    renderWithServices(<LettersTab />, { handlers })
    const grid = await screen.findByTestId('letters-grid')
    await userEvent.click(grid.querySelector<HTMLElement>('[data-letter="l_alef"]')!)
    expect(AudioMock).toHaveBeenCalledWith('/content/a.mp3')
    expect(play).toHaveBeenCalled()
  })

  it('the CTA opens the current letters lesson', async () => {
    renderWithServices(<LettersTab />, { handlers })
    const cta = await screen.findByRole('link', { name: 'Learn the letters' })
    expect(cta).toHaveAttribute('href', '/lesson?course=fixture&kind=letters&level=u01-letters-1')
  })

  it('the CTA replays the last lesson once all are done', async () => {
    const done = {
      ...TEST_LETTERS,
      lessons: TEST_LETTERS.lessons.map((l) => ({ ...l, state: 'completed' as const })),
    }
    renderWithServices(<LettersTab />, { handlers: { ...handlers, letters: () => done } })
    expect(await screen.findByRole('link', { name: 'Learn the letters' })).toHaveAttribute(
      'href',
      '/lesson?course=fixture&kind=letters&level=u01-letters-2',
    )
  })

  it('lists the lessons in teaching order with their states', async () => {
    renderWithServices(<LettersTab />, { handlers })
    const heading = await screen.findByRole('heading', { name: 'Lessons' })
    const list = heading.parentElement!.querySelector('ol')!
    const items = [...list.querySelectorAll<HTMLElement>('li')]
    expect(items.map((i) => i.dataset.lesson)).toEqual(['u01-letters-1', 'u01-letters-2'])
    expect(items.map((i) => i.dataset.state)).toEqual(['current', 'locked'])
    expect(within(items[0]!).getByText('Up next')).toBeInTheDocument()
    expect(
      within(items[0]!).getByRole('link', { name: 'Start: Letters that never connect' }),
    ).toHaveAttribute('href', '/lesson?course=fixture&kind=letters&level=u01-letters-1')
    expect(within(items[1]!).getByText('Locked')).toBeInTheDocument()
    expect(within(items[1]!).queryByRole('link')).toBeNull()
    // The lesson's letters, each its own Persian element.
    expect([...items[0]!.querySelectorAll('[lang="fa"]')].map((e) => e.textContent)).toEqual([
      'ا',
      'د',
    ])
  })
})
