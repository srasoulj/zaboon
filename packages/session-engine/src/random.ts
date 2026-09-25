/** Deterministic randomness: every choice the engine makes flows from a string seed. */

/** Mulberry32 over a string hash: deterministic per seed. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Picks up to `count` candidates, best score first; equal scores are ordered randomly so sessions
 * vary while staying deterministic per seed. Lower score = better.
 */
export function pickBest<T>(
  candidates: readonly T[],
  count: number,
  score: (c: T) => number,
  rnd: () => number,
): T[] {
  return candidates
    .map((c) => ({ c, s: score(c), r: rnd() }))
    .sort((a, b) => a.s - b.s || a.r - b.r)
    .slice(0, Math.max(0, count))
    .map((x) => x.c)
}
