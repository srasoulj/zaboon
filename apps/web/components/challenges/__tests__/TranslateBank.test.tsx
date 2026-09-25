import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fixture, renderChallenge, persianOf } from '../testing'

const ZWNJ = '‌'
const faEn = fixture('translate_bank', 0)
const enFa = fixture('translate_bank', 1)

const bank = () => screen.getByRole('group', { name: 'Word bank' })
const answer = () => screen.getByRole('group', { name: 'Your answer' })

describe('translate_bank fa→en', () => {
  it('shows the instruction, the Persian prompt and an LTR answer line of English tiles', () => {
    expect(faEn.direction).toBe('fa_en')
    renderChallenge(faEn)
    expect(screen.getByRole('heading', { name: 'Write this in English' })).toBeInTheDocument()
    expect(persianOf(screen.getByRole('group', { name: 'Prompt' }))).toHaveTextContent(
      faEn.prompt.text,
    )
    expect(answer()).toHaveAttribute('dir', 'ltr')
    expect(within(bank()).getAllByRole('button')).toHaveLength(faEn.bank.length)
  })

  it('tapping I · want · water builds a tiles draft graded correct', async () => {
    const h = renderChallenge(faEn)
    for (const w of ['I', 'want', 'water'])
      await h.user.click(within(bank()).getByRole('button', { name: w }))
    expect(h.last()).toEqual({ kind: 'tiles', value: ['I', 'want', 'water'] })
    expect(h.verdict()).toBe('correct')
    expect(
      within(answer())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['I', 'want', 'water'])
  })

  it('a wrong sentence is graded wrong; emptying the line clears the draft', async () => {
    const h = renderChallenge(faEn)
    for (const w of ['I', 'want', 'tea'])
      await h.user.click(within(bank()).getByRole('button', { name: w }))
    expect(h.verdict()).toBe('wrong')
    for (const w of ['tea', 'want', 'I'])
      await h.user.click(within(answer()).getByRole('button', { name: w }))
    expect(h.last()).toBeNull()
  })

  it('works with the keyboard alone (Enter adds, focus moves on, Backspace removes)', async () => {
    const h = renderChallenge(faEn)
    within(bank()).getByRole('button', { name: 'I' }).focus()
    await h.user.keyboard('{Enter}{Enter}{Enter}')
    expect(h.last()).toEqual({ kind: 'tiles', value: ['I', 'want', 'water'] })
    within(answer()).getByRole('button', { name: 'water' }).focus()
    await h.user.keyboard('{Backspace}')
    expect(h.last()).toEqual({ kind: 'tiles', value: ['I', 'want'] })
  })

  it('locks the tiles in feedback and marks the answer line', async () => {
    const h = renderChallenge(faEn)
    for (const w of ['I', 'want', 'water'])
      await h.user.click(within(bank()).getByRole('button', { name: w }))
    h.check()
    expect(answer()).toHaveAttribute('data-state', 'correct')
    for (const b of screen.getAllByRole('button', { name: /^(I|want|water|tea)$/ }))
      expect(b).toBeDisabled()
    await h.user.click(within(answer()).getByRole('button', { name: 'water' }))
    expect(h.onResponse).toHaveBeenCalledTimes(3)
  })

  it('renders a given draft back onto the answer line (e.g. a feedback screen)', () => {
    renderChallenge(faEn, {
      phase: 'feedback',
      response: { kind: 'tiles', value: ['I', 'want', 'tea'] },
    })
    expect(
      within(answer())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['I', 'want', 'tea'])
    expect(answer()).toHaveAttribute('data-state', 'wrong')
  })
})

describe('translate_bank en→fa', () => {
  it('shows the English prompt and an RTL answer line of whole-word Persian tiles', () => {
    expect(enFa.direction).toBe('en_fa')
    renderChallenge(enFa)
    expect(screen.getByRole('heading', { name: 'Write this in Persian' })).toBeInTheDocument()
    expect(screen.getByText(enFa.prompt.text)).toHaveAttribute('lang', 'en')
    expect(answer()).toHaveAttribute('dir', 'rtl')
    const tile = within(bank()).getByRole('button', { name: `می${ZWNJ}خوام` })
    expect(tile).toHaveAttribute('lang', 'fa')
    expect(tile.childNodes).toHaveLength(1) // one text node: letters are never split
  })

  it('نون می‌خوام is graded correct, بابا می‌خوام wrong', async () => {
    const h = renderChallenge(enFa)
    for (const w of ['نون', `می${ZWNJ}خوام`])
      await h.user.click(within(bank()).getByRole('button', { name: w }))
    expect(h.last()).toEqual({ kind: 'tiles', value: ['نون', `می${ZWNJ}خوام`] })
    expect(h.verdict()).toBe('correct')
    await h.user.click(within(answer()).getByRole('button', { name: 'نون' }))
    await h.user.click(within(answer()).getByRole('button', { name: `می${ZWNJ}خوام` }))
    for (const w of ['بابا', `می${ZWNJ}خوام`])
      await h.user.click(within(bank()).getByRole('button', { name: w }))
    expect(h.verdict()).toBe('wrong')
  })
})
