import '../test-utils'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HALF_SPACE_CODE, KEYBOARD_LAYOUTS, KEYBOARD_ROWS, ZWJ, ZWNJ } from '@zaboon/farsi'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider } from '../motion-preference'
import {
  keyFace,
  LONG_PRESS_MS,
  PersianKeyboard,
  type PersianKeyboardLayout,
} from './PersianKeyboard'

const LAYOUTS: PersianKeyboardLayout[] = ['standard', 'phonetic']

function setup(layout: PersianKeyboardLayout = 'phonetic', extra: { disabled?: boolean } = {}) {
  const onKey = vi.fn<(text: string) => void>()
  const onBackspace = vi.fn()
  const onEnter = vi.fn()
  const utils = render(
    <PersianKeyboard
      layout={layout}
      onKey={onKey}
      onBackspace={onBackspace}
      onEnter={onEnter}
      {...extra}
    />,
  )
  const kbd = screen.getByRole('group', { name: 'Persian keyboard' })
  const key = (code: string) => kbd.querySelector<HTMLButtonElement>(`[data-code="${code}"]`)!
  return { ...utils, kbd, key, onKey, onBackspace, onEnter }
}

/** The accessible name a key must have for a character. */
function expectedName(ch: string): string {
  return keyFace(ch).label ?? ch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('keyFace', () => {
  it('announces visible letters as themselves and names invisible or combining characters', () => {
    expect(keyFace('س')).toEqual({ text: 'س', lang: 'fa' })
    expect(keyFace(ZWNJ).label).toMatch(/non-joiner/)
    expect(keyFace(ZWJ).label).toMatch(/joiner/)
    expect(keyFace('َ')).toEqual({ text: '◌َ', lang: 'fa', label: 'fatha' })
    expect(keyFace('ٰ').label).toBe('superscript alef')
    expect(keyFace('ـ').label).toBe('tatweel')
  })
})

describe('PersianKeyboard', () => {
  it.each(LAYOUTS)(
    '%s: draws every key of KEYBOARD_ROWS with its character as the name',
    (layout) => {
      const { kbd, key } = setup(layout)
      expect(kbd).toHaveAttribute('lang', 'en')
      expect(kbd).toHaveAttribute('data-layout', layout)
      const codes = KEYBOARD_ROWS[layout].flat().filter((c) => c !== HALF_SPACE_CODE)
      for (const code of codes) {
        const base = KEYBOARD_LAYOUTS[layout].keys[code]!.base
        const btn = key(code)
        expect(btn, code).toBeInstanceOf(HTMLButtonElement)
        expect(btn).toHaveAttribute('type', 'button')
        expect(btn).toHaveAccessibleName(expectedName(base))
        const glyph = btn.querySelector('.zb-kbd__glyph')!
        expect(glyph).toHaveAttribute('dir', glyph.getAttribute('lang') === 'fa' ? 'rtl' : 'ltr')
      }
      // Every lang="fa" element is RTL and never carries an English aria-label.
      for (const fa of kbd.querySelectorAll('[lang="fa"]')) {
        expect(fa).toHaveAttribute('dir', 'rtl')
        expect(fa).not.toHaveAttribute('aria-label')
      }
      // The space row is drawn as the bottom row of named keys.
      for (const name of ['shift', 'half-space', 'space', 'backspace', 'enter']) {
        expect(within(kbd).getByRole('button', { name })).toBeInTheDocument()
      }
      expect(kbd.querySelector(`[data-code="${HALF_SPACE_CODE}"]`)).toBeNull()
    },
  )

  it('tapping a key types its character', async () => {
    const user = userEvent.setup()
    const { onKey } = setup('standard')
    await user.click(screen.getByRole('button', { name: 'س' }))
    await user.click(screen.getByRole('button', { name: 'ا' }))
    expect(onKey.mock.calls).toEqual([['س'], ['ا']])
  })

  it('Shift shows and types the shift level once, then turns itself off', async () => {
    const user = userEvent.setup()
    const { key, onKey } = setup('standard')
    const shift = screen.getByRole('button', { name: 'shift' })
    expect(shift).toHaveAttribute('aria-pressed', 'false')
    await user.click(shift)
    expect(shift).toHaveAttribute('aria-pressed', 'true')
    expect(key('KeyH')).toHaveAccessibleName('آ')
    expect(key('KeyU')).toHaveAccessibleName('fatha')
    expect(key('KeyU').textContent).toBe('◌َ')
    await user.click(key('KeyU'))
    expect(onKey).toHaveBeenLastCalledWith('َ') // the mark alone, not the dotted circle
    expect(shift).toHaveAttribute('aria-pressed', 'false')
    expect(key('KeyH')).toHaveAccessibleName('ا')
    // Toggling twice turns it off without typing.
    await user.click(shift)
    await user.click(shift)
    expect(shift).toHaveAttribute('aria-pressed', 'false')
    expect(onKey).toHaveBeenCalledTimes(1)
  })

  it('the half-space key types ZWNJ; space, backspace and enter do their jobs', async () => {
    const user = userEvent.setup()
    const { onKey, onBackspace, onEnter } = setup('phonetic')
    const half = screen.getByRole('button', { name: 'half-space' })
    expect(half).toHaveTextContent('half-space')
    await user.click(half)
    await user.click(screen.getByRole('button', { name: 'space' }))
    expect(onKey.mock.calls).toEqual([[ZWNJ], [' ']])
    await user.click(screen.getByRole('button', { name: 'backspace' }))
    await user.click(screen.getByRole('button', { name: 'enter' }))
    expect(onBackspace).toHaveBeenCalledTimes(1)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('keeps focus in the host field: pointerdown and mousedown are cancelled', () => {
    const { kbd } = setup('phonetic')
    for (const btn of kbd.querySelectorAll('button')) {
      expect(fireEvent.pointerDown(btn)).toBe(false)
      fireEvent.pointerUp(btn)
      expect(fireEvent.mouseDown(btn)).toBe(false)
    }
  })

  it('works from the keyboard alone: Tab reaches the keys, Enter and Space type', async () => {
    const user = userEvent.setup()
    const { key, onKey } = setup('standard')
    await user.tab()
    expect(key('Backquote')).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.tab()
    await user.keyboard(' ')
    expect(onKey.mock.calls).toEqual([[ZWJ], ['۱']])
  })

  it('marks keys with variants and shows a hint dot', () => {
    const { key } = setup('phonetic')
    expect(key('KeyZ')).toHaveAttribute('aria-haspopup', 'true')
    expect(key('KeyZ')).toHaveAttribute('aria-expanded', 'false')
    expect(key('KeyZ').querySelector('.zb-kbd__hint')).not.toBeNull()
    expect(key('KeyB')).not.toHaveAttribute('aria-haspopup')
    expect(key('KeyB').querySelector('.zb-kbd__hint')).toBeNull()
  })

  it('a short tap on a key with variants types the base letter', () => {
    vi.useFakeTimers()
    const { key, onKey } = setup('phonetic')
    fireEvent.pointerDown(key('KeyZ'))
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 100))
    fireEvent.pointerUp(key('KeyZ'))
    fireEvent.click(key('KeyZ'))
    expect(onKey.mock.calls).toEqual([['ز']])
    expect(screen.queryByRole('group', { name: /More letters/ })).toBeNull()
  })

  it('a long press opens the variants; releasing over one types it', () => {
    vi.useFakeTimers()
    const { key, onKey } = setup('phonetic')
    fireEvent.pointerDown(key('KeyZ'))
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    const row = screen.getByRole('group', { name: 'More letters like ز' })
    expect(key('KeyZ')).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(row)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['ذ', 'ض', 'ظ'])
    fireEvent.pointerUp(within(row).getByRole('button', { name: 'ض' }))
    expect(onKey.mock.calls).toEqual([['ض']])
    expect(screen.queryByRole('group', { name: /More letters/ })).toBeNull()
  })

  it('a long press released on the key keeps the row open; tapping a variant types it', () => {
    vi.useFakeTimers()
    const { key, onKey } = setup('phonetic')
    fireEvent.pointerDown(key('KeyS'))
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    fireEvent.pointerUp(key('KeyS'))
    fireEvent.click(key('KeyS')) // the click that ends the long press does not type the base
    act(() => vi.runOnlyPendingTimers())
    expect(onKey).not.toHaveBeenCalled()
    const row = screen.getByRole('group', { name: 'More letters like س' })
    const sad = within(row).getByRole('button', { name: 'ص' })
    expect(fireEvent.pointerDown(sad)).toBe(false)
    fireEvent.pointerUp(sad)
    fireEvent.click(sad)
    expect(onKey.mock.calls).toEqual([['ص']])
    expect(screen.queryByRole('group', { name: /More letters/ })).toBeNull()
  })

  it('a press outside the variant row closes it', () => {
    vi.useFakeTimers()
    const { key } = setup('phonetic')
    fireEvent.pointerDown(key('KeyT'))
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
    fireEvent.pointerUp(key('KeyT'))
    act(() => vi.runOnlyPendingTimers())
    expect(screen.getByRole('group', { name: 'More letters like ت' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: /More letters/ })).toBeNull()
  })

  it('variants from the keyboard: ArrowUp opens and focuses, arrows move, Escape returns, Enter types', async () => {
    const user = userEvent.setup()
    const { key, onKey } = setup('phonetic')
    key('KeyZ').focus()
    await user.keyboard('{ArrowUp}')
    const row = screen.getByRole('group', { name: 'More letters like ز' })
    const [zal, zad, za] = within(row).getAllByRole('button')
    expect(zal).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(zad).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(za).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: /More letters/ })).toBeNull()
    expect(key('KeyZ')).toHaveFocus()
    expect(onKey).not.toHaveBeenCalled()

    fireEvent.keyDown(key('KeyZ'), { key: 'ContextMenu' })
    expect(
      within(screen.getByRole('group', { name: 'More letters like ز' })).getAllByRole('button')[0],
    ).toHaveFocus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onKey.mock.calls).toEqual([['ض']])
    expect(screen.queryByRole('group', { name: /More letters/ })).toBeNull()
    expect(key('KeyZ')).toHaveFocus()
  })

  it('Escape in the variant row does not reach the host', async () => {
    const user = userEvent.setup()
    const onHostKey = vi.fn()
    window.addEventListener('keydown', onHostKey)
    const { key } = setup('phonetic')
    key('KeyH').focus()
    await user.keyboard('{ArrowUp}{Escape}')
    window.removeEventListener('keydown', onHostKey)
    expect(onHostKey.mock.calls.map(([e]) => (e as KeyboardEvent).key)).toEqual(['ArrowUp'])
  })

  it('disabled: every key is disabled and nothing types', async () => {
    const user = userEvent.setup()
    const { kbd, onKey, onEnter } = setup('phonetic', { disabled: true })
    const buttons = within(kbd).getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(40)
    for (const b of buttons) expect(b).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'ب' }))
    await user.click(screen.getByRole('button', { name: 'enter' }))
    expect(onKey).not.toHaveBeenCalled()
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('accepts a custom label and class', () => {
    render(
      <PersianKeyboard
        layout="standard"
        label="Type in Persian"
        className="extra"
        onKey={() => {}}
        onBackspace={() => {}}
        onEnter={() => {}}
      />,
    )
    const kbd = screen.getByRole('group', { name: 'Type in Persian' })
    expect(kbd).toHaveClass('zb-kbd', 'extra')
  })

  it('marks itself for reduced motion (OS setting or in-app toggle)', () => {
    const { kbd, rerender } = setup('phonetic')
    expect(kbd).not.toHaveAttribute('data-reduce-motion')
    rerender(
      <MotionPreferenceProvider reduce>
        <PersianKeyboard
          layout="phonetic"
          onKey={() => {}}
          onBackspace={() => {}}
          onEnter={() => {}}
        />
      </MotionPreferenceProvider>,
    )
    expect(screen.getByRole('group', { name: 'Persian keyboard' })).toHaveAttribute(
      'data-reduce-motion',
      'true',
    )
  })
})
