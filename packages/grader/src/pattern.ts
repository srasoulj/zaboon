/**
 * Accepted-answer pattern syntax (docs/LEARNING-ENGINE.md §3.1): space-separated tokens,
 * `[a/b/c]` groups (one alternative; an empty one makes the group optional; alternatives may be
 * several words), no nesting, `\[`, `\]`, `\/` escapes.
 */

/** One slot of a pattern: its alternatives, each a list of words (empty list = optional). */
export type Segment = { alts: string[][]; group: boolean }

/** Parses one pattern into slots: a plain word is a one-alternative slot. Throws when malformed. */
export function parsePattern(pattern: string): Segment[] {
  const out: Segment[] = []
  let i = 0
  let word = ''
  const flush = () => {
    for (const w of word.trim().split(/\s+/)) if (w) out.push({ alts: [[w]], group: false })
    word = ''
  }
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '\\' && i + 1 < pattern.length) {
      word += pattern[i + 1]
      i += 2
      continue
    }
    if (ch === '[') {
      flush()
      const alts: string[] = []
      let cur = ''
      i++
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '[') throw new Error(`nested [ in pattern: ${pattern}`)
        if (pattern[i] === '\\' && i + 1 < pattern.length) {
          cur += pattern[i + 1]
          i += 2
          continue
        }
        if (pattern[i] === '/') {
          alts.push(cur.trim())
          cur = ''
        } else cur += pattern[i]
        i++
      }
      if (pattern[i] !== ']') throw new Error(`unclosed [ in pattern: ${pattern}`)
      alts.push(cur.trim())
      out.push({ alts: alts.map((a) => (a ? a.split(/\s+/) : [])), group: true })
      i++
      continue
    }
    if (ch === ']') throw new Error(`unexpected ] in pattern: ${pattern}`)
    word += ch
    i++
  }
  flush()
  return out
}
