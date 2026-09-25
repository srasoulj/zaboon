import { describe, expect, it } from 'vitest'
import { digitsArToEn, digitsEnToFa, digitsFaToEn, wordsToNumber } from '@persian-tools/persian-tools'
import {
  ALPHABET,
  HAZM_TRANSLATION_DST,
  HAZM_TRANSLATION_SRC,
  isSameSound,
  letterForms,
  looseKey,
  looseTokens,
  normalize,
  NORMALIZER_VERSION,
  PERSIAN_NUMBER_WORDS,
  persianNumberValue,
  sameSoundGroup,
  soundKey,
  toAsciiDigits,
  toPersianDigits,
  tokenize,
  ZWNJ,
} from './index'

describe('normalize (beyond the oracle)', () => {
  it('drops a ZWNJ next to a space or at either end and collapses ZWNJ runs', () => {
    expect(normalize(`می${ZWNJ} خوام`)).toBe('می خوام')
    expect(normalize(`${ZWNJ}سلام${ZWNJ}`)).toBe('سلام')
    expect(normalize(`می${ZWNJ}${ZWNJ}خوام`)).toBe(`می${ZWNJ}خوام`)
    expect(normalize(`«${ZWNJ}سلام»`)).toBe('سلام')
  })

  it('folds Arabic presentation forms to base letters', () => {
    // ﺳﻼﻡ: seen, lam-alef ligature, meem (copied from an old PDF)
    expect(normalize('ﺳﻼﻡ')).toBe('سلام')
    expect(normalize('ﺁﺑ')).toBe('آب')
  })

  it("maps Hazm's rarer Arabic/Urdu letter variants", () => {
    expect(normalize('ھمه')).toBe('همه') // Urdu heh doachashmee
    expect(normalize('ڪتاب')).toBe('کتاب') // swash kaf
    expect(normalize('یک')).toBe('یک')
  })

  it('keeps the letters the oracle pins as strict-only (ە ة ۀ أ)', () => {
    for (const ch of ['ە', 'ة', 'ۀ', 'أ']) expect(normalize(`خان${ch}`)).toBe(`خان${ch}`)
  })

  it('strips soft hyphens, word joiners and the Arabic letter mark', () => {
    expect(normalize('سل­ا⁠م؜')).toBe('سلام')
  })

  it('bumped the normalizer version for the real pipeline', () => {
    expect(NORMALIZER_VERSION).toBeGreaterThanOrEqual(2)
  })
})

describe('looseKey (beyond the oracle)', () => {
  it('folds an ezāfe ی typed as its own word after a final ه (decision: like ه‌ی)', () => {
    expect(looseKey('خونه ی من')).toBe(looseKey(`خونه${ZWNJ}ی من`))
    expect(looseKey('خونه ی من')).toBe('خونه من')
    expect(looseKey('خونه ی')).toBe('خونه')
  })

  it('still joins ی after a vowel that is not ه', () => {
    expect(looseKey('دانشجو ی خوب')).toBe('دانشجوی خوب')
  })

  it('joins a prefix and a suffix around one word', () => {
    expect(looseKey('نمی خوام ها')).toBe('نمیخوامها')
    expect(looseKey('می')).toBe('می')
    expect(looseKey('ها')).toBe('ها')
  })

  it('stays idempotent when a joined suffix makes a new prefix (fast-check counterexample)', () => {
    // م + the suffix ی = می, itself a prefix: one more pass joined it to the next token.
    const key = looseKey('م ی\nا')
    expect(key).toBe('میا')
    expect(looseKey(key)).toBe(key)
    expect(looseKey('ن م ی خوام')).toBe(looseKey(looseKey('ن م ی خوام')))
  })

  it('tokenizes the strict and loose forms', () => {
    expect(tokenize(`کتاب ها رو می${ZWNJ}خوام`)).toEqual(['کتاب', 'ها', 'رو', `می${ZWNJ}خوام`])
    expect(looseTokens(`کتاب ها رو می${ZWNJ}خوام`)).toEqual(['کتابها', 'رو', 'میخوام'])
    expect(looseTokens(' ؟ ')).toEqual([])
  })
})

describe('digits', () => {
  it('agrees with @persian-tools/persian-tools', () => {
    const fa = '۰۱۲۳۴۵۶۷۸۹'
    const ar = '٠١٢٣٤٥٦٧٨٩'
    expect(toAsciiDigits(fa)).toBe(digitsFaToEn(fa))
    expect(toAsciiDigits(ar)).toBe(digitsArToEn(ar))
    expect(toPersianDigits('0123456789')).toBe(digitsEnToFa('0123456789'))
  })
})

describe('letters', () => {
  it('has 32 letters and ZWJ forms for joiners and non-joiners', () => {
    expect(ALPHABET).toHaveLength(32)
    expect(letterForms('ب')).toEqual({ isolated: 'ب', initial: 'ب‍', medial: '‍ب‍', final: '‍ب' })
    expect(letterForms('و')).toEqual({ isolated: 'و', initial: 'و', medial: '‍و', final: '‍و' })
  })

  it('knows the same-sound groups', () => {
    expect(sameSoundGroup('ص')).toEqual(['س', 'ص', 'ث'])
    expect(sameSoundGroup('ب')).toBeNull()
    expect(isSameSound('ظ', 'ز')).toBe(true)
    expect(isSameSound('ز', 'ز')).toBe(false)
    expect(isSameSound('ز', 'ژ')).toBe(false)
    expect(soundKey('صد')).toBe(soundKey('سد'))
    expect(soundKey('خداحافظ')).toBe(soundKey('خداهافز'))
    expect(soundKey('صد')).not.toBe(soundKey('شد'))
  })

  it('has number words that agree with persian-tools wordsToNumber', () => {
    for (const [word, value] of PERSIAN_NUMBER_WORDS) {
      if (['شیش', 'پونزده', 'شونزده', 'هیفده', 'هیجده', 'پونصد', 'یکصد', 'صفر'].includes(word)) continue
      expect(wordsToNumber(word), word).toBe(value)
    }
    expect(persianNumberValue('12')).toBe(12)
    expect(persianNumberValue('سه')).toBe(3)
    expect(persianNumberValue('سلام')).toBeNull()
  })

  it('ports the Hazm translation table with matching lengths', () => {
    expect([...HAZM_TRANSLATION_SRC]).toHaveLength([...HAZM_TRANSLATION_DST].length)
  })
})
