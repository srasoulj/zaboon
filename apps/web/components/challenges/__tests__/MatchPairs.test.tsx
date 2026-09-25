import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge } from '../testing'

const c = fixture('match_pairs')
const fa = () => screen.getByRole('group', { name: 'Persian' })
const en = () => screen.getByRole('group', { name: 'English' })

describe('match_pairs', () => {
  it('shows two columns; the Persian one is RTL with lang="fa" buttons', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Select the matching pairs' })).toBeInTheDocument()
    expect(fa()).toHaveAttribute('dir', 'rtl')
    const buttons = within(fa()).getAllByRole('button')
    expect(buttons).toHaveLength(c.pairs.length)
    for (const b of buttons) expect(b).toHaveAttribute('lang', 'fa')
    expect(within(en()).getAllByRole('button')).toHaveLength(c.pairs.length)
  })

  it('matching every pair reports {kind:"pairs"} graded correct and submits', async () => {
    const h = renderChallenge(c)
    for (const [i, p] of c.pairs.entries()) {
      // alternate the side tapped first
      if (i % 2 === 0) {
        await h.user.click(within(fa()).getByRole('button', { name: p.fa.fa }))
        await h.user.click(within(en()).getByRole('button', { name: p.en }))
      } else {
        await h.user.click(within(en()).getByRole('button', { name: p.en }))
        await h.user.click(within(fa()).getByRole('button', { name: p.fa.fa }))
      }
      expect(within(en()).getByRole('button', { name: p.en })).toBeDisabled()
    }
    expect(h.onResponse).toHaveBeenCalledTimes(1)
    expect(h.last()).toEqual({ kind: 'pairs', value: c.pairs.map((_, i) => [i, i]) })
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
    expect(h.onMismatch).not.toHaveBeenCalled()
  })

  it('a wrong pair shakes, calls onMismatch and reports nothing (a wrong draft cannot be built)', async () => {
    const h = renderChallenge(c)
    await h.user.click(within(fa()).getByRole('button', { name: c.pairs[0]!.fa.fa }))
    await h.user.click(within(en()).getByRole('button', { name: c.pairs[1]!.en }))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
    expect(h.onResponse).not.toHaveBeenCalled()
    expect(within(en()).getByRole('button', { name: /^thanks/ })).toHaveAttribute(
      'data-shake',
      'true',
    )
    expect(within(fa()).getByRole('button', { name: /^سلام/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // an incomplete draft graded by the player would be wrong
    expect(h.last()).toBeNull()
  })

  it('does not shake under reduced motion', async () => {
    const h = renderChallenge(c, { display: { reducedMotion: true } })
    await h.user.click(within(fa()).getByRole('button', { name: c.pairs[0]!.fa.fa }))
    await h.user.click(within(en()).getByRole('button', { name: c.pairs[1]!.en }))
    expect(h.onMismatch).toHaveBeenCalledTimes(1)
    expect(within(en()).getByRole('button', { name: /^thanks/ })).toHaveAttribute(
      'data-shake',
      'false',
    )
  })

  it('tapping the same button again deselects it; tapping a Persian word says it when sound is on', async () => {
    const h = renderChallenge(c, { display: { sound: true } })
    const salam = within(fa()).getByRole('button', { name: c.pairs[0]!.fa.fa })
    await h.user.click(salam)
    expect(salam).toHaveAttribute('aria-pressed', 'true')
    expect(h.audio.play).toHaveBeenCalledWith(c.pairs[0]!.fa.audio!.normal)
    await h.user.click(salam)
    expect(salam).toHaveAttribute('aria-pressed', 'false')
  })

  it('works with the keyboard alone', async () => {
    const h = renderChallenge(c)
    for (const p of c.pairs) {
      within(fa()).getByRole('button', { name: p.fa.fa }).focus()
      await h.user.keyboard('{Enter}')
      within(en()).getByRole('button', { name: p.en }).focus()
      await h.user.keyboard(' ')
    }
    expect(h.verdict()).toBe('correct')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('digit keys tap buttons in reading order', async () => {
    const h = renderChallenge(c)
    const first = within(fa()).getAllByRole('button')[0]!
    await h.user.keyboard('1')
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(h.onMismatch).not.toHaveBeenCalled()
  })

  it('is locked in feedback', async () => {
    const h = renderChallenge(c, {
      phase: 'feedback',
      response: { kind: 'pairs', value: [[0, 0]] },
    })
    expect(within(fa()).getByRole('button', { name: c.pairs[0]!.fa.fa })).toBeDisabled()
    await h.user.click(within(fa()).getByRole('button', { name: c.pairs[1]!.fa.fa }))
    await h.user.click(within(en()).getByRole('button', { name: c.pairs[2]!.en }))
    expect(h.onMismatch).not.toHaveBeenCalled()
    expect(h.onResponse).not.toHaveBeenCalled()
  })
})
