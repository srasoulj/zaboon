// Contract tests: MUST pass for both the Wave 0 stub and the real implementation.
import { describe, expect, it } from 'vitest'
import {
  letterForms,
  looseKey,
  normalize,
  tokenize,
  toAsciiDigits,
  toPersianDigits,
  isPersian,
  ZWNJ,
} from './index'

describe('@zaboon/farsi contract', () => {
  it('normalizes Arabic letter variants and whitespace', () => {
    expect(normalize('  علي  كتاب ')).toBe('علی کتاب')
  })
  it('keeps ZWNJ in the strict form but not in the loose key', () => {
    const w = `می${ZWNJ}خوام`
    expect(normalize(w)).toContain(ZWNJ)
    expect(looseKey(w)).not.toContain(ZWNJ)
    expect(looseKey(w)).toBe(looseKey('میخوام'))
  })
  it('tokenizes on whitespace, keeping ZWNJ compounds whole', () => {
    expect(tokenize(`من آب می${ZWNJ}خوام`)).toEqual(['من', 'آب', `می${ZWNJ}خوام`])
    expect(tokenize('   ')).toEqual([])
  })
  it('converts digits both ways', () => {
    expect(toAsciiDigits('۱۲٣')).toBe('123')
    expect(toPersianDigits('2026')).toBe('۲۰۲۶')
  })
  it('detects Persian', () => {
    expect(isPersian('salām')).toBe(false)
    expect(isPersian('سلام')).toBe(true)
  })
  it('builds ZWJ letter forms', () => {
    expect(letterForms('ب').medial).toBe('‍ب‍')
    expect(letterForms('د').initial).toBe('د')
  })
})
