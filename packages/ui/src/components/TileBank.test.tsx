import '../test-utils'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TileBank, WordTile, type Tile } from './TileBank'

const ZWNJ = '\u200C'
const TILES: Tile[] = [
  { id: 'a', text: 'من', lang: 'fa' },
  { id: 'b', text: 'آب', lang: 'fa' },
  { id: 'c', text: `می${ZWNJ}خوام`, lang: 'fa' },
  { id: 'd', text: 'آب', lang: 'fa' },
]

function Harness({ onChange, disabled }: { onChange?: (a: string[]) => void; disabled?: boolean }) {
  const [answer, setAnswer] = useState<string[]>([])
  return (
    <TileBank
      tiles={TILES}
      answer={answer}
      dir="rtl"
      disabled={disabled}
      onChange={(a) => {
        setAnswer(a)
        onChange?.(a)
      }}
    />
  )
}

const answerGroup = () => screen.getByRole('group', { name: 'Your answer' })
const bankGroup = () => screen.getByRole('group', { name: 'Word bank' })

describe('WordTile', () => {
  it('is one button with one whole-word text node, lang and dir', () => {
    render(<WordTile text={`می${ZWNJ}خوام`} lang="fa" />)
    const tile = screen.getByRole('button')
    expect(tile.childNodes).toHaveLength(1)
    expect(tile).toHaveTextContent(`می${ZWNJ}خوام`)
    expect(tile).toHaveAttribute('lang', 'fa')
    expect(tile).toHaveAttribute('dir', 'rtl')
  })

  it('English tiles are ltr', () => {
    render(<WordTile text="water" lang="en" />)
    expect(screen.getByRole('button')).toHaveAttribute('dir', 'ltr')
  })
})

describe('TileBank', () => {
  it('uses the explicit dir on the answer line', () => {
    render(<Harness />)
    expect(answerGroup()).toHaveAttribute('dir', 'rtl')
  })

  it('moves a tile to the answer line and leaves a grey placeholder in the bank', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const user = userEvent.setup()
    await user.click(within(bankGroup()).getByRole('button', { name: `می${ZWNJ}خوام` }))
    expect(onChange).toHaveBeenLastCalledWith(['c'])
    expect(within(answerGroup()).getByRole('button', { name: `می${ZWNJ}خوام` })).toBeInTheDocument()
    expect(within(bankGroup()).queryByRole('button', { name: `می${ZWNJ}خوام` })).toBeNull()
    const placeholder = bankGroup().querySelector('.zb-tile--placeholder')
    expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    // The bank keeps its slot order: placeholder sits where the tile was.
    expect(bankGroup().children[2]).toBe(placeholder)
  })

  it('keeps answer order and treats duplicate words as separate tiles', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const user = userEvent.setup()
    const [b, d] = within(bankGroup()).getAllByRole('button', { name: 'آب' })
    await user.click(d!)
    await user.click(within(bankGroup()).getByRole('button', { name: 'من' }))
    await user.click(b!)
    expect(onChange).toHaveBeenLastCalledWith(['d', 'a', 'b'])
    expect(within(answerGroup()).getAllByRole('button').map((x) => x.textContent)).toEqual(['آب', 'من', 'آب'])
  })

  it('tapping an answer tile sends it back to its slot', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const user = userEvent.setup()
    await user.click(within(bankGroup()).getByRole('button', { name: 'من' }))
    await user.click(within(answerGroup()).getByRole('button', { name: 'من' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(within(bankGroup()).getAllByRole('button')).toHaveLength(4)
    expect(bankGroup().querySelector('.zb-tile--placeholder')).toBeNull()
  })

  it('works from the keyboard: Enter adds, Backspace on the answer line removes the last tile', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const user = userEvent.setup()
    within(bankGroup()).getByRole('button', { name: 'من' }).focus()
    await user.keyboard('{Enter}')
    within(bankGroup()).getAllByRole('button', { name: 'آب' })[0]!.focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b'])
    within(answerGroup()).getAllByRole('button')[0]!.focus()
    await user.keyboard('{Backspace}')
    expect(onChange).toHaveBeenLastCalledWith(['a'])
  })

  it('ignores taps when disabled', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} disabled />)
    await userEvent.setup().click(within(bankGroup()).getByRole('button', { name: 'من' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores unknown ids in the answer', () => {
    render(<TileBank tiles={TILES} answer={['zzz', 'a']} onChange={() => {}} dir="ltr" />)
    expect(within(answerGroup()).getAllByRole('button')).toHaveLength(1)
  })
})
