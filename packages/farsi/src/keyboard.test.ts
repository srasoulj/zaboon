import { describe, expect, it } from 'vitest'
import {
  ALPHABET,
  HALF_SPACE_CODE,
  KEYBOARD_LAYOUTS,
  KEYBOARD_ROWS,
  keyChar,
  normalize,
  remapPhysicalKey,
  sameSoundGroup,
  ZWNJ,
  type PhysicalKeyEvent,
} from './index'

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
  it.each(['standard', 'phonetic'] as const)(
    '%s: types every Persian letter, آ, digits and the half-space',
    (id) => {
      const chars = typeable(id)
      for (const letter of [...ALPHABET, 'آ']) expect(chars.has(letter), letter).toBe(true)
      for (const d of '۰۱۲۳۴۵۶۷۸۹') expect(chars.has(d), d).toBe(true)
      expect(chars.has(ZWNJ)).toBe(true)
      expect(keyChar(id, HALF_SPACE_CODE, { shift: true })).toBe(ZWNJ)
      expect(keyChar(id, HALF_SPACE_CODE)).toBe(' ')
    },
  )

  it.each(['standard', 'phonetic'] as const)('%s: keys are KeyboardEvent.code values', (id) => {
    for (const code of Object.keys(KEYBOARD_LAYOUTS[id].keys))
      expect(code).toMatch(
        /^(Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space)$/,
      )
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

describe('KEYBOARD_ROWS', () => {
  it.each(['standard', 'phonetic'] as const)('%s: draws every mapped key exactly once', (id) => {
    const drawn = KEYBOARD_ROWS[id].flat()
    expect(new Set(drawn).size).toBe(drawn.length)
    expect([...drawn].sort()).toEqual(Object.keys(KEYBOARD_LAYOUTS[id].keys).sort())
  })

  it.each(['standard', 'phonetic'] as const)('%s: rows are physical rows, space bar last', (id) => {
    const rows = KEYBOARD_ROWS[id]
    expect(rows.at(-1)).toEqual([HALF_SPACE_CODE])
    expect(rows.find((r) => r.includes('KeyQ'))?.slice(0, 3)).toEqual(['KeyQ', 'KeyW', 'KeyE'])
    expect(rows.find((r) => r.includes('KeyA'))?.[0]).toBe('KeyA')
    expect(rows.find((r) => r.includes('KeyZ'))?.[0]).toBe('KeyZ')
  })
})

describe('remapPhysicalKey', () => {
  const ev = (over: Partial<PhysicalKeyEvent>): PhysicalKeyEvent => ({
    key: 'a',
    code: 'KeyA',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...over,
  })

  it('remaps a Latin key by its physical code', () => {
    expect(remapPhysicalKey('standard', ev({}))).toBe('ش')
    expect(remapPhysicalKey('phonetic', ev({}))).toBe('ا')
    // The code decides, not the key: AZERTY's "q" sits on KeyA.
    expect(remapPhysicalKey('standard', ev({ key: 'q' }))).toBe('ش')
    expect(remapPhysicalKey('standard', ev({ key: 'H', code: 'KeyH', shiftKey: true }))).toBe('آ')
    expect(remapPhysicalKey('phonetic', ev({ key: 'S', code: 'KeyS', shiftKey: true }))).toBe('ش')
    expect(remapPhysicalKey('standard', ev({ key: ';', code: 'Semicolon' }))).toBe('ک')
  })

  it('Shift+Space types the half-space; Space a space', () => {
    for (const id of ['standard', 'phonetic'] as const) {
      expect(remapPhysicalKey(id, ev({ key: ' ', code: HALF_SPACE_CODE, shiftKey: true }))).toBe(
        ZWNJ,
      )
      expect(remapPhysicalKey(id, ev({ key: ' ', code: HALF_SPACE_CODE }))).toBe(' ')
    }
  })

  it('leaves OS Persian layouts alone (event.key is already Persian)', () => {
    expect(remapPhysicalKey('standard', ev({ key: 'ش' }))).toBeNull()
    expect(remapPhysicalKey('phonetic', ev({ key: ZWNJ, code: 'KeyB', shiftKey: true }))).toBeNull()
  })

  it('never remaps while composing, on keyCode 229, or with Ctrl/Meta/Alt', () => {
    expect(remapPhysicalKey('standard', ev({ isComposing: true }))).toBeNull()
    expect(remapPhysicalKey('standard', ev({ keyCode: 229 }))).toBeNull()
    expect(remapPhysicalKey('standard', ev({ key: 'Process', keyCode: 229 }))).toBeNull()
    expect(remapPhysicalKey('standard', ev({ ctrlKey: true }))).toBeNull()
    expect(remapPhysicalKey('standard', ev({ metaKey: true }))).toBeNull()
    expect(remapPhysicalKey('standard', ev({ altKey: true }))).toBeNull()
  })

  it('ignores named keys and unmapped codes', () => {
    for (const key of ['Enter', 'Backspace', 'Tab', 'ArrowLeft', 'Dead', 'Unidentified'])
      expect(remapPhysicalKey('standard', ev({ key, code: key }))).toBeNull()
    expect(remapPhysicalKey('phonetic', ev({ key: '-', code: 'Minus' }))).toBeNull()
    expect(remapPhysicalKey('standard', ev({ key: 'é', code: 'Digit2' }))).toBeNull()
  })
})
