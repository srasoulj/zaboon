import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ANNOUNCE_DELAY_MS } from '../MatchColumns'
import { MatchPairs } from '../MatchPairs'
import { DISPLAY, fixture, renderChallenge, startsWith, tabTo } from '../testing'

const c = fixture('match_pairs')
const fa = () => screen.getByRole('group', { name: 'Persian' })
const en = () => screen.getByRole('group', { name: 'English' })
const faCard = (i: number) =>
  within(fa()).getByRole('button', { name: startsWith(c.pairs[i]!.fa.fa) })
const enCard = (i: number) => within(en()).getByRole('button', { name: startsWith(c.pairs[i]!.en) })
const status = () => screen.getByRole('status')

describe('match_pairs', () => {
  it('shows an RTL Persian column; only the Persian content (not the card) is lang="fa"', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Select the matching pairs' })).toBeInTheDocument()
    expect(fa()).toHaveAttribute('dir', 'rtl')
    const buttons = within(fa()).getAllByRole('button')
    expect(buttons).toHaveLength(c.pairs.length)
    for (const b of buttons) {
      expect(b).not.toHaveAttribute('lang')
      expect(b.querySelector('[lang="fa"][dir="rtl"]')).not.toBeNull()
    }
    expect(within(en()).getAllByRole('button')).toHaveLength(c.pairs.length)
  })

  it('gives every one of the 10 cards a shortcut: 1–5 left, 6–9 and 0 right', () => {
    renderChallenge(c)
    const keys = [
      ...within(fa()).getAllByRole('button'),
      ...within(en()).getAllByRole('button'),
    ].map((b) => b.getAttribute('aria-keyshortcuts'))
    expect(keys).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
    const tenth = within(en()).getAllByRole('button')[4]!
    expect(tenth.querySelector('kbd')).toHaveTextContent('0')
  })

  it('matching every pair reports {kind:"pairs"} graded correct and submits', async () => {
    const h = renderChallenge(c)
    for (const [i] of c.pairs.entries()) {
      // alternate the side tapped first
      if (i % 2 === 0) {
        await h.user.click(faCard(i))
        await h.user.click(enCard(i))
      } else {
        await h.user.click(enCard(i))
        await h.user.click(faCard(i))
      }
      expect(enCard(i)).toHaveAttribute('aria-disabled', 'true')
      expect(enCard(i)).toHaveAttribute('data-matched', 'true')
    }
    expect(h.onResponse).toHaveBeenCalledTimes(1)
    expect(h.last()).toEqual({ kind: 'pairs', value: c.pairs.map((_, i) => [i, i]) })
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
    expect(h.onMismatch).not.toHaveBeenCalled()
    await waitFor(() => expect(status()).toHaveTextContent('All pairs matched.'))
  })

  it('announces matches and mismatches politely', async () => {
    const h = renderChallenge(c)
    await h.user.click(faCard(0))
    await h.user.click(enCard(0))
    await waitFor(() =>
      expect(status()).toHaveTextContent(`Matched. 1 of ${c.pairs.length} pairs done.`),
    )
    await h.user.click(faCard(1))
    await h.user.click(enCard(2))
    await waitFor(() => expect(status()).toHaveTextContent('Not a match. Try again.'))
  })

  it('announces a second identical mismatch again (the region is cleared, then set)', async () => {
    const h = renderChallenge(c)
    const texts: string[] = []
    const observer = new MutationObserver(() => texts.push(status().textContent ?? ''))
    observer.observe(status(), { childList: true, characterData: true, subtree: true })
    try {
      for (let round = 0; round < 2; round++) {
        await h.user.click(faCard(1))
        await h.user.click(enCard(2))
        await waitFor(() => expect(status()).toHaveTextContent('Not a match. Try again.'))
      }
    } finally {
      observer.disconnect()
    }
    const shown = texts.filter((t) => t === 'Not a match. Try again.')
    expect(shown).toHaveLength(2)
    expect(texts[texts.lastIndexOf('Not a match. Try again.') - 1]).toBe('')
    expect(h.onMismatch).toHaveBeenCalledTimes(2)
  })

  it('shows a new message at once, without waiting for a timer', () => {
    vi.useFakeTimers()
    try {
      renderChallenge(c)
      fireEvent.click(faCard(0))
      fireEvent.click(enCard(0))
      expect(status()).toHaveTextContent(`Matched. 1 of ${c.pairs.length} pairs done.`)
      fireEvent.click(faCard(1))
      fireEvent.click(enCard(2))
      expect(status()).toHaveTextContent('Not a match. Try again.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a repeated message, then sets it again after the delay', () => {
    vi.useFakeTimers()
    try {
      const h = renderChallenge(c)
      fireEvent.click(faCard(1))
      fireEvent.click(enCard(2))
      expect(status()).toHaveTextContent('Not a match. Try again.')
      fireEvent.click(faCard(1))
      fireEvent.click(enCard(2))
      expect(status().textContent).toBe('')
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS - 1))
      expect(status().textContent).toBe('')
      act(() => vi.advanceTimersByTime(1))
      expect(status()).toHaveTextContent('Not a match. Try again.')
      expect(h.onMismatch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not swallow Enter on a selected card (the player turns it into CHECK)', async () => {
    const seen = vi.fn()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') seen(e.defaultPrevented)
    }
    window.addEventListener('keydown', onKey)
    try {
      const h = renderChallenge(c)
      await tabTo(h.user, faCard(0))
      await h.user.keyboard('{Enter}')
      expect(faCard(0)).toHaveAttribute('aria-pressed', 'true')
      await h.user.keyboard('{Enter}')
    } finally {
      window.removeEventListener('keydown', onKey)
    }
    expect(seen).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenLastCalledWith(false)
  })

  it('a wrong pair shakes, calls onMismatch and reports nothing (a wrong draft cannot be built)', async () => {
    const h = renderChallenge(c)
    await h.user.click(faCard(0))
    await h.user.click(enCard(1))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
    expect(h.onResponse).not.toHaveBeenCalled()
    expect(enCard(1)).toHaveAttribute('data-shake', 'true')
    expect(faCard(0)).toHaveAttribute('aria-pressed', 'false')
    expect(h.last()).toBeNull()
  })

  it('does not shake under reduced motion', async () => {
    const h = renderChallenge(c, { display: { reducedMotion: true } })
    await h.user.click(faCard(0))
    await h.user.click(enCard(1))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
    expect(enCard(1)).toHaveAttribute('data-shake', 'false')
  })

  it('tapping the same button again deselects it; tapping a Persian word says it when sound is on', async () => {
    const h = renderChallenge(c, { display: { sound: true } })
    await h.user.click(faCard(0))
    expect(faCard(0)).toHaveAttribute('aria-pressed', 'true')
    expect(h.audio.play).toHaveBeenCalledWith(c.pairs[0]!.fa.audio!.normal)
    await h.user.click(faCard(0))
    expect(faCard(0)).toHaveAttribute('aria-pressed', 'false')
  })

  it('works with the keyboard alone (Tab + Enter/Space); focus stays on the matched card', async () => {
    const h = renderChallenge(c)
    for (const [i] of c.pairs.entries()) {
      await tabTo(h.user, faCard(i))
      await h.user.keyboard('{Enter}')
      await tabTo(h.user, enCard(i))
      await h.user.keyboard(' ')
      expect(enCard(i)).toHaveFocus() // not lost to <body>
    }
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('digit keys tap cards in reading order, including 0 for the tenth', async () => {
    const h = renderChallenge(c)
    await h.user.keyboard('1')
    expect(within(fa()).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
    await h.user.keyboard('1')
    await h.user.keyboard('0')
    expect(within(en()).getAllByRole('button')[4]).toHaveAttribute('aria-pressed', 'true')
    expect(h.onMismatch).not.toHaveBeenCalled()
  })

  it('ignores digit keys while a modal dialog is open', async () => {
    const h = renderChallenge(c)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.append(dialog)
    await h.user.keyboard('1')
    await h.user.keyboard('6')
    dialog.remove()
    for (const b of screen.getAllByRole('button'))
      expect(b).not.toHaveAttribute('aria-pressed', 'true')
    expect(h.onMismatch).not.toHaveBeenCalled()
    expect(h.onResponse).not.toHaveBeenCalled()
  })

  it('submits only once the player holds the complete draft', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const audio = { play: vi.fn(), stop: vi.fn(), mouthOpen: () => 0 }
    // A player that drops the draft (e.g. while its quit dialog is open) never echoes it back.
    render(
      <MatchPairs
        challenge={c}
        response={null}
        onResponse={() => {}}
        onSubmit={onSubmit}
        onMismatch={() => {}}
        phase="answering"
        verdict={null}
        display={DISPLAY}
        audio={audio}
      />,
    )
    for (const [i] of c.pairs.entries()) {
      await user.click(faCard(i))
      await user.click(enCard(i))
    }
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('is locked in feedback', async () => {
    const h = renderChallenge(c, {
      phase: 'feedback',
      response: { kind: 'pairs', value: [[0, 0]] },
    })
    expect(faCard(0)).toHaveAttribute('aria-disabled', 'true')
    await h.user.click(faCard(1))
    await h.user.click(enCard(2))
    await h.user.keyboard('1')
    expect(h.onMismatch).not.toHaveBeenCalled()
    expect(h.onResponse).not.toHaveBeenCalled()
  })
})
