import { fireEvent, screen, within } from '@testing-library/react'
import type { ChallengeOf } from '@zaboon/contracts'
import { ZWNJ } from '@zaboon/farsi'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIXTURES, renderChallenge, tabTo } from '../testing'

// The P2 en→fa translate_type of the fixture's u01-t1: «نون می‌خوام» ("I want bread").
const c = FIXTURES.find(
  (x): x is ChallengeOf<'translate_type'> => x.type === 'translate_type' && x.answerLang === 'fa',
)!
const box = () => screen.getByRole('textbox', { name: 'Your answer in Persian' })
const keyboard = () => screen.getByRole('group', { name: 'Persian keyboard' })
const key = (name: string) => within(keyboard()).getByRole('button', { name })
const ON = { persianKeyboard: true } as const

/** Taps the on-screen keys that type `text` on the standard layout. */
async function tapKeys(user: ReturnType<typeof renderChallenge>['user'], text: string) {
  for (const ch of text)
    await user.click(key(ch === ' ' ? 'space' : ch === ZWNJ ? 'half-space' : ch))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('translate_type en→fa (typed Persian)', () => {
  it('is an RTL Persian textarea labelled in English', () => {
    renderChallenge(c)
    expect(screen.getByRole('heading', { name: 'Type this in Persian' })).toBeInTheDocument()
    expect(box()).toHaveAttribute('lang', 'fa')
    expect(box()).toHaveAttribute('dir', 'rtl')
    expect(box()).not.toHaveAttribute('aria-label')
    expect(screen.getByText('Your answer in Persian')).toHaveAttribute('lang', 'en')
  })

  it('without the in-app keyboard: no keyboard, OS Persian typing works unchanged', async () => {
    const h = renderChallenge(c)
    expect(screen.queryByRole('group', { name: 'Persian keyboard' })).toBeNull()
    await h.user.type(box(), `نون می${ZWNJ}خوام`)
    expect(h.last()).toEqual({ kind: 'text', value: `نون می${ZWNJ}خوام` })
    expect(h.verdict()).toBe('correct')
  })

  it('physical Latin keys are remapped to the layout by their code', async () => {
    const h = renderChallenge(c, { display: ON })
    await h.user.click(box())
    // Standard layout: K = ن, Comma = و, L = م, D = ی, Shift+Space = half-space, O = خ, H = ا.
    const press = (key: string, code: string, shiftKey = false) =>
      expect(fireEvent.keyDown(box(), { key, code, shiftKey })).toBe(false) // handled here
    press('k', 'KeyK')
    press(',', 'Comma')
    press('k', 'KeyK')
    press(' ', 'Space')
    press('l', 'KeyL')
    press('d', 'KeyD')
    press(' ', 'Space', true)
    press('o', 'KeyO')
    press(',', 'Comma')
    press('h', 'KeyH')
    press('l', 'KeyL')
    expect(box()).toHaveValue(`نون می${ZWNJ}خوام`)
    expect(h.verdict()).toBe('correct')
  })

  it('never remaps while composing, on keyCode 229 or with Ctrl', () => {
    renderChallenge(c, { display: ON })
    for (const init of [
      { key: 'a', code: 'KeyA', isComposing: true },
      { key: 'a', code: 'KeyA', keyCode: 229 },
      { key: 'a', code: 'KeyA', ctrlKey: true },
      { key: 'ش', code: 'KeyA' },
    ])
      expect(fireEvent.keyDown(box(), init)).toBe(true) // not prevented: the browser handles it
    expect(fireEvent.keyDown(box(), { key: 'a', code: 'KeyA' })).toBe(false)
    expect(box()).toHaveValue('ش')
  })

  it('the on-screen keyboard types at the caret and is graded like typing', async () => {
    const h = renderChallenge(c, { display: ON })
    await tapKeys(h.user, `نون می${ZWNJ}خوام`)
    expect(box()).toHaveValue(`نون می${ZWNJ}خوام`)
    expect(h.last()).toEqual({ kind: 'text', value: `نون می${ZWNJ}خوام` })
    expect(h.verdict()).toBe('correct')
    // A key typed with the caret after the first word lands there, replacing the selection.
    box().focus()
    ;(box() as HTMLTextAreaElement).setSelectionRange(3, 3)
    await h.user.click(key('ب'))
    expect(box()).toHaveValue(`نونب می${ZWNJ}خوام`)
    ;(box() as HTMLTextAreaElement).setSelectionRange(3, 4)
    await h.user.click(key('backspace'))
    expect(box()).toHaveValue(`نون می${ZWNJ}خوام`)
  })

  it('a wrong answer is graded wrong; backspace to empty clears the draft', async () => {
    const h = renderChallenge(c, { display: ON })
    await tapKeys(h.user, 'سیب')
    expect(h.verdict()).toBe('wrong')
    for (let i = 0; i < 3; i++) await h.user.click(key('backspace'))
    expect(box()).toHaveValue('')
    expect(h.last()).toBeNull()
  })

  it('Enter (physical or on-screen) checks once there is an answer; Shift+Enter is a newline', async () => {
    const h = renderChallenge(c, { display: ON })
    await h.user.click(key('enter'))
    expect(h.onSubmit).not.toHaveBeenCalled()
    await tapKeys(h.user, 'نون')
    await h.user.click(key('enter'))
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
    await h.user.click(box())
    await h.user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(h.onSubmit).toHaveBeenCalledTimes(1)
    await h.user.keyboard('{Enter}')
    expect(h.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('keyboard-only: Tab reaches the keys and Enter on a key types it', async () => {
    const h = renderChallenge(c, { display: ON })
    await tabTo(h.user, key('ن'))
    await h.user.keyboard('{Enter}')
    expect(box()).toHaveValue('ن')
    expect(key('half-space')).toHaveAccessibleName('half-space')
  })

  it('touch devices get inputmode="none" while the in-app keyboard is shown', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const a = renderChallenge(c, { display: ON })
    expect(box()).toHaveAttribute('inputmode', 'none')
    a.unmount()
    renderChallenge(c)
    expect(box()).not.toHaveAttribute('inputmode')
  })

  it('locks in feedback: read-only, keys disabled, nothing typed', async () => {
    const h = renderChallenge(c, { display: ON })
    await tapKeys(h.user, 'نون')
    h.check()
    expect(box()).toHaveAttribute('readonly')
    expect(box()).toHaveAttribute('data-state', 'wrong')
    expect(key('ب')).toBeDisabled()
    fireEvent.keyDown(box(), { key: 'b', code: 'KeyF' })
    await h.user.type(box(), 'x{Enter}')
    expect(box()).toHaveValue('نون')
    expect(h.onSubmit).not.toHaveBeenCalled()
  })
})
