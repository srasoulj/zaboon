/**
 * The 13+ gate (ARCHITECTURE §12, COPPA): a learner who gives an age under 13 can't continue, and
 * the block is remembered on this device so reloading or going back doesn't offer the question again.
 */
export const MIN_AGE = 13
export const AGE_BLOCK_KEY = 'zaboon.ageBlocked'

export function isAgeBlocked(): boolean {
  try {
    return globalThis.localStorage?.getItem(AGE_BLOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberAgeBlock(): void {
  try {
    globalThis.localStorage?.setItem(AGE_BLOCK_KEY, '1')
  } catch {
    // Storage unavailable: the block still holds for this page.
  }
}

/** Parses the typed age: a whole number of years, 1–120; anything else is null. */
export function parseAge(input: string): number | null {
  const t = input.trim()
  if (!/^\d{1,3}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 120 ? n : null
}
