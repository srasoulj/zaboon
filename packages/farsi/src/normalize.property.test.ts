// Property tests (fast-check) for the normalization pipeline.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { looseKey, normalize, tokenize } from './index'

/** Characters the pipeline treats specially, plus ordinary Persian and Latin text. */
const PIECES = [
  ...'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیآ',
  'می',
  'نمی',
  'ها',
  'های',
  'ی',
  'ای',
  'تر',
  'ترین',
  'ام',
  'اش',
  'شان',
  'ه‌ی',
  'ه‌ای',
  'ي',
  'ى',
  'ك',
  'ە',
  'ة',
  'ۀ',
  'هٔ',
  'أ',
  'إ',
  'ٱ',
  'آ',
  'ئ',
  'ئی',
  'َ',
  'ِ',
  'ّ',
  'ً',
  'ٰ',
  'ـ',
  '‌',
  '‍',
  '​',
  '‎',
  '‏',
  '‫',
  '‬',
  '⁧',
  '⁩',
  '﻿',
  ' ',
  ' ',
  '  ',
  '\t',
  '\n',
  '،',
  '؛',
  '؟',
  '«',
  '»',
  '.',
  '!',
  '?',
  ',',
  ';',
  ':',
  '۱',
  '۲',
  '٣',
  '7',
  'a',
  'B',
  "'",
  'ﺳ',
  'ﻼ',
  'ھ',
]

const text = fc.array(fc.constantFrom(...PIECES), { maxLength: 24 }).map((parts) => parts.join(''))
const anyText = fc.oneof(text, fc.string({ unit: 'grapheme', maxLength: 24 }), fc.string({ maxLength: 24 }))

describe('normalization properties', () => {
  it('normalize is idempotent', () => {
    fc.assert(fc.property(anyText, (s) => normalize(normalize(s)) === normalize(s)), { numRuns: 3000 })
  })

  it('looseKey(normalize(x)) === looseKey(x)', () => {
    fc.assert(fc.property(anyText, (s) => looseKey(normalize(s)) === looseKey(s)), { numRuns: 3000 })
  })

  it('looseKey is idempotent', () => {
    fc.assert(fc.property(text, (s) => looseKey(looseKey(s)) === looseKey(s)), { numRuns: 3000 })
  })

  it('normalized text has no leading, trailing or doubled spaces and no ZWNJ at a token edge', () => {
    fc.assert(
      fc.property(anyText, (s) => {
        const n = normalize(s)
        expect(n).toBe(n.trim())
        expect(n).not.toMatch(/\s\s|[^\S ]/)
        for (const tok of tokenize(s)) {
          expect(tok.startsWith('‌')).toBe(false)
          expect(tok.endsWith('‌')).toBe(false)
        }
      }),
      { numRuns: 2000 },
    )
  })

  it('the loose key never contains a ZWNJ', () => {
    fc.assert(fc.property(anyText, (s) => !looseKey(s).includes('‌')), { numRuns: 2000 })
  })
})
