/**
 * Physical-key maps for the in-app PersianKeyboard (docs/LEARNING-ENGINE.md §1.4, P2).
 *
 * Keys are `KeyboardEvent.code` values (the physical key, independent of the OS layout). The UI
 * remaps a key only when `event.key` is a Latin character and `!event.isComposing`, so OS Persian
 * layouts and IMEs are left alone.
 *
 * - `standard`: ISIRI 9147 (the Iranian national standard, "Persian (Standard)" on Windows/macOS).
 *   Shift gives the second level: harakat on the top letter row, hamza forms on the home row, the
 *   Persian punctuation, and ZWNJ on Shift+Space and Shift+B (the standard's two half-space keys).
 * - `phonetic`: letters grouped by sound for English speakers. Each Latin key types the most common
 *   Persian letter for that sound; letters that sound the same are long-press `variants`
 *   (z → ز ذ ض ظ, s → س ص ث, t → ت ط, h → ه ح, q/"gh" → غ ق). Shift gives the digraph sound
 *   (s → ش "sh", z → ژ "zh", k → خ "kh", c → چ "ch", q → ق). Backquote and Shift+Space are the
 *   half-space (ZWNJ) key.
 */
import { ZWJ, ZWNJ } from './normalize'

export interface KeyDef {
  /** Character typed without modifiers. */
  base: string
  /** Character typed with Shift. */
  shift?: string
  /** Long-press alternatives (phonetic layout), in display order, excluding `base`. */
  variants?: readonly string[]
}

/** Physical-key maps for the in-app keyboard (P2). Keys are KeyboardEvent.code values. */
export interface KeyboardLayout {
  id: 'standard' | 'phonetic'
  keys: Readonly<Record<string, KeyDef>>
}

/** The `KeyboardEvent.code` of the dedicated half-space key in both layouts (with Shift). */
export const HALF_SPACE_CODE = 'Space'

/** ISIRI 9147 standard Persian layout. */
const STANDARD: Readonly<Record<string, KeyDef>> = {
  // Number row
  Backquote: { base: ZWJ, shift: '÷' },
  Digit1: { base: '۱', shift: '!' },
  Digit2: { base: '۲', shift: '٬' },
  Digit3: { base: '۳', shift: '٫' },
  Digit4: { base: '۴', shift: '\uFDFC' },
  Digit5: { base: '۵', shift: '٪' },
  Digit6: { base: '۶', shift: '×' },
  Digit7: { base: '۷', shift: '،' },
  Digit8: { base: '۸', shift: '*' },
  Digit9: { base: '۹', shift: ')' },
  Digit0: { base: '۰', shift: '(' },
  Minus: { base: '-', shift: '\u0640' },
  Equal: { base: '=', shift: '+' },
  // Top letter row: shift = harakat
  KeyQ: { base: 'ض', shift: '\u0652' },
  KeyW: { base: 'ص', shift: '\u064C' },
  KeyE: { base: 'ث', shift: '\u064D' },
  KeyR: { base: 'ق', shift: '\u064B' },
  KeyT: { base: 'ف', shift: '\u064F' },
  KeyY: { base: 'غ', shift: '\u0650' },
  KeyU: { base: 'ع', shift: '\u064E' },
  KeyI: { base: 'ه', shift: '\u0651' },
  KeyO: { base: 'خ', shift: ']' },
  KeyP: { base: 'ح', shift: '[' },
  BracketLeft: { base: 'ج', shift: '}' },
  BracketRight: { base: 'چ', shift: '{' },
  Backslash: { base: '\\', shift: '|' },
  // Home row: shift = hamza forms and guillemets
  KeyA: { base: 'ش', shift: 'ؤ' },
  KeyS: { base: 'س', shift: 'ئ' },
  KeyD: { base: 'ی', shift: 'ي' },
  KeyF: { base: 'ب', shift: 'إ' },
  KeyG: { base: 'ل', shift: 'أ' },
  KeyH: { base: 'ا', shift: 'آ' },
  KeyJ: { base: 'ت', shift: 'ة' },
  KeyK: { base: 'ن', shift: '»' },
  KeyL: { base: 'م', shift: '«' },
  Semicolon: { base: 'ک', shift: ':' },
  Quote: { base: 'گ', shift: '؛' },
  // Bottom row
  KeyZ: { base: 'ظ', shift: 'ك' },
  KeyX: { base: 'ط', shift: '\u0653' },
  KeyC: { base: 'ز', shift: 'ژ' },
  KeyV: { base: 'ر', shift: '\u0670' },
  KeyB: { base: 'ذ', shift: ZWNJ },
  KeyN: { base: 'د', shift: '\u0654' },
  KeyM: { base: 'پ', shift: 'ء' },
  Comma: { base: 'و', shift: '>' },
  Period: { base: '.', shift: '<' },
  Slash: { base: '/', shift: '؟' },
  Space: { base: ' ', shift: ZWNJ },
}

/** Sound-grouped layout for learners who know the Latin keyboard. */
const PHONETIC: Readonly<Record<string, KeyDef>> = {
  Backquote: { base: ZWNJ },
  Digit1: { base: '۱', shift: '!' },
  Digit2: { base: '۲' },
  Digit3: { base: '۳' },
  Digit4: { base: '۴' },
  Digit5: { base: '۵', shift: '٪' },
  Digit6: { base: '۶' },
  Digit7: { base: '۷' },
  Digit8: { base: '۸' },
  Digit9: { base: '۹', shift: ')' },
  Digit0: { base: '۰', shift: '(' },
  // a/ā: ا, with آ (ā at the start of a word) and ع (the glottal ʿeyn)
  KeyA: { base: 'ا', shift: 'آ', variants: ['آ', 'ع'] },
  KeyB: { base: 'ب' },
  KeyC: { base: 'چ', shift: 'چ' },
  KeyD: { base: 'د' },
  // e: the glottal stop letters (the vowel e itself is not written)
  KeyE: { base: 'ع', variants: ['ء', 'ئ', 'أ', 'ؤ'] },
  KeyF: { base: 'ف' },
  KeyG: { base: 'گ' },
  KeyH: { base: 'ه', variants: ['ح'] },
  KeyI: { base: 'ی' },
  KeyJ: { base: 'ج' },
  KeyK: { base: 'ک', shift: 'خ' },
  KeyL: { base: 'ل' },
  KeyM: { base: 'م' },
  KeyN: { base: 'ن' },
  KeyO: { base: 'و' },
  KeyP: { base: 'پ' },
  // q stands for "gh"
  KeyQ: { base: 'غ', shift: 'ق', variants: ['ق'] },
  KeyR: { base: 'ر' },
  KeyS: { base: 'س', shift: 'ش', variants: ['ص', 'ث'] },
  KeyT: { base: 'ت', variants: ['ط'] },
  KeyU: { base: 'و' },
  KeyV: { base: 'و' },
  KeyW: { base: 'و' },
  KeyX: { base: 'خ' },
  KeyY: { base: 'ی' },
  KeyZ: { base: 'ز', shift: 'ژ', variants: ['ذ', 'ض', 'ظ'] },
  Comma: { base: '،' },
  Semicolon: { base: '؛' },
  Slash: { base: '؟' },
  Period: { base: '.' },
  Quote: { base: '«', shift: '»' },
  Space: { base: ' ', shift: ZWNJ },
}

export const KEYBOARD_LAYOUTS: Readonly<Record<'standard' | 'phonetic', KeyboardLayout>> = {
  standard: { id: 'standard', keys: STANDARD },
  phonetic: { id: 'phonetic', keys: PHONETIC },
}

type LayoutId = 'standard' | 'phonetic'

const LETTER_ROWS: readonly (readonly string[])[] = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
]
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']

/**
 * Drawing order of the keys (`KeyboardEvent.code`s) per row, top to bottom, in physical (left to
 * right) order. Every mapped key of a layout appears exactly once; the last row is the space bar.
 * The on-screen keyboard adds its own half-space, backspace and enter keys around these.
 */
export const KEYBOARD_ROWS: Readonly<Record<LayoutId, readonly (readonly string[])[]>> = {
  standard: [
    ['Backquote', ...DIGITS, 'Minus', 'Equal'],
    [...LETTER_ROWS[0]!, 'BracketLeft', 'BracketRight', 'Backslash'],
    LETTER_ROWS[1]!,
    LETTER_ROWS[2]!,
    ['Space'],
  ],
  phonetic: [['Backquote', ...DIGITS], LETTER_ROWS[0]!, LETTER_ROWS[1]!, LETTER_ROWS[2]!, ['Space']],
}

/** The parts of a `KeyboardEvent` the physical-key remap looks at (DOM-free). */
export interface PhysicalKeyEvent {
  key: string
  code: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
  /** Deprecated but still the only IME signal on Android (229 = "being composed"). */
  keyCode?: number
}

/**
 * What a physical key press should type in the in-app layout (§1.4), or null to leave the event to
 * the browser. A key is remapped by `event.code` only when `event.key` is a single Latin
 * (printable ASCII) character, nothing is being composed, no Ctrl/Meta/Alt is held and the event
 * is not Android's IME placeholder (keyCode 229). So an OS Persian layout (whose `key` is already
 * Persian), IMEs and shortcuts pass through unchanged. Shift+Space (`HALF_SPACE_CODE`) types ZWNJ.
 */
export function remapPhysicalKey(layout: LayoutId, e: PhysicalKeyEvent): string | null {
  if (e.isComposing || e.keyCode === 229) return null
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (!/^[\x20-\x7E]$/.test(e.key)) return null
  return keyChar(layout, e.code, { shift: e.shiftKey })
}

/**
 * The character a physical key types in a layout, or null when the layout leaves the key alone.
 * `variant` picks a long-press alternative (0 = base).
 */
export function keyChar(
  layout: LayoutId,
  code: string,
  opts: { shift?: boolean; variant?: number } = {},
): string | null {
  const def = KEYBOARD_LAYOUTS[layout].keys[code]
  if (!def) return null
  if (opts.variant) return def.variants?.[opts.variant - 1] ?? null
  return opts.shift ? (def.shift ?? def.base) : def.base
}
