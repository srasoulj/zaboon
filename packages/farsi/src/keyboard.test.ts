import { describe, expect, it } from 'vitest'
import { ALPHABET, HALF_SPACE_CODE, KEYBOARD_LAYOUTS, keyChar, normalize, sameSoundGroup, ZWNJ } from './index'

const typeable = (id: 'standard' | 'phonetic') => {
  const chars = new Set<string>()
  for (const def of Object.values(KEYBOARD_LAYOUTS[id].keys)) {
    chars.add(def.base)
    if (def.shift) chars.add(def.shift)
    for (const v of def.variants ?? []) chars.add(v)
  }
  return chars
}

describe('keyboard layouts', () => {
  it.each(['standard', 'phonetic'] as const)('%s: types every Persian letter, آ, digits and the half-space', (id) => {
    const chars = typeable(id)
    for (const letter of [...ALPHABET, 'آ']) expect(chars.has(letter), letter).toBe(true)
    for (const d of '۰۱۲۳۴۵۶۷۸۹') expect(chars.has(d), d).toBe(true)
    expect(chars.has(ZWNJ)).toBe(true)
    expect(keyChar(id, HALF_SPACE_CODE, { shift: true })).toBe(ZWNJ)
    expect(keyChar(id, HALF_SPACE_CODE)).toBe(' ')
  })

  it.each(['standard', 'phonetic'] as const)('%s: keys are KeyboardEvent.code values', (id) => {
    for (const code of Object.keys(KEYBOARD_LAYOUTS[id].keys))
      expect(code).toMatch(/^(Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space)$/)
  })

  it('standard follows ISIRI 9147 on sample keys', () => {
    const k = KEYBOARD_LAYOUTS.standard.keys
    expect(k.KeyQ?.base).toBe('ض')
    expect(k.KeyH).toEqual({ base: 'ا', shift: 'آ' })
    expect(k.KeyD?.base).toBe('ی')
    expect(k.Semicolon?.base).toBe('ک')
    expect(k.Quote?.base).toBe('گ')
    expect(k.Comma?.base).toBe('و')
    expect(k.KeyB?.shift).toBe(ZWNJ)
    expect(k.Slash?.shift).toBe('؟')
  })

  it('standard base letters are already normalized (no Arabic look-alikes on the base layer)', () => {
    for (const def of Object.values(KEYBOARD_LAYOUTS.standard.keys))
      if (/[\u0621-\u064A\u067E-\u06D5]/.test(def.base)) expect(normalize(def.base)).toBe(def.base)
  })

  it('phonetic groups letters by sound with long-press variants', () => {
    const k = KEYBOARD_LAYOUTS.phonetic.keys
    expect(k.KeyZ).toMatchObject({ base: 'ز', variants: ['ذ', 'ض', 'ظ'] })
    expect(k.KeyS).toMatchObject({ base: 'س', variants: ['ص', 'ث'] })
    expect(k.KeyT).toMatchObject({ base: 'ت', variants: ['ط'] })
    expect(k.KeyH).toMatchObject({ base: 'ه', variants: ['ح'] })
    expect(k.KeyQ).toMatchObject({ base: 'غ', variants: ['ق'] })
    for (const code of ['KeyZ', 'KeyS', 'KeyT', 'KeyH', 'KeyQ']) {
      const def = k[code]!
      expect([def.base, ...def.variants!].sort()).toEqual([...sameSoundGroup(def.base)!].sort())
    }
    expect(keyChar('phonetic', 'KeyZ', { variant: 3 })).toBe('ظ')
    expect(keyChar('phonetic', 'KeyZ', { variant: 9 })).toBeNull()
    expect(keyChar('phonetic', 'KeyS', { shift: true })).toBe('ش')
    expect(keyChar('phonetic', 'F13')).toBeNull()
  })
})
