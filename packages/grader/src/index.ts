/**
 * @zaboon/grader: accepted-answer patterns → token DAG, and grading (docs/LEARNING-ENGINE.md §3, §7).
 *
 * Wave 0 STUB: a real pattern parser plus exact-match grading. Owner: ws-farsi-grader, who adds the
 * automatic merges (pronoun drop, register, orthography variants), the typo/spelling verdicts,
 * min-cost alignment and whole-word diffs, and must pass packages/grader/oracles/golden.yaml.
 * The public API below is the contract; keep signatures stable.
 */
import type { AnswerGraph } from '@zaboon/content-schema'
import { looseKey, normalize, NORMALIZER_VERSION } from '@zaboon/farsi'

export const IMPLEMENTATION: 'stub' | 'real' = 'stub'
/** Increment on any change that can change a verdict. Clients report it; the server keeps a window. */
export const GRADER_VERSION = 1 + (NORMALIZER_VERSION - 1)

export type Lang = 'fa' | 'en'
export type Verdict = 'correct' | 'typo' | 'spelling' | 'wrong'

export interface CompileOptions {
  lang: Lang
  /** The item's faFormal: merged as a register alternative (Persian only). */
  formal?: string
  /** Sentence-initial subject pronoun becomes optional (Persian only). Default true. */
  pronounDrop?: boolean
  /** Course-wide orthography variant sets. */
  variants?: readonly (readonly string[])[]
}

export interface GradeOptions {
  lang: Lang
  /** 'bank' = word-bank tiles: exact DAG membership only (no typo/spelling leniency). */
  mode: 'typed' | 'bank'
  /** Other course words: a same-sound spelling swap that lands on one of these is wrong. */
  lexicon?: readonly string[]
}

export interface DiffToken {
  text: string
  status: 'ok' | 'wrong' | 'missing' | 'extra' | 'typo' | 'spelling'
}

export interface GradeResult {
  verdict: Verdict
  /** Closest accepted answer, in the learner's register when known. */
  closestSolution: string
  /** Whole-word diff of the closest solution against the answer. */
  diff: DiffToken[]
  graderVersion: number
}

/** Parses one pattern into segments: plain words and `[a/b/]` alternative groups. */
function parsePattern(pattern: string): (string | string[])[] {
  const out: (string | string[])[] = []
  let i = 0
  let word = ''
  const flush = () => {
    if (word.trim()) out.push(...word.trim().split(/\s+/))
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
      out.push(alts)
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

/** Compiles accepted-answer patterns into one token DAG. */
export function compile(patterns: readonly string[], opts: CompileOptions): AnswerGraph {
  const all = [...patterns]
  if (opts.lang === 'fa' && opts.formal) all.push(opts.formal)
  if (all.length === 0) throw new Error('compile: no patterns')
  const edges: AnswerGraph['edges'] = []
  let next = 1
  const start = 0
  const accept: number[] = []
  for (const p of all) {
    let cur = start
    for (const seg of parsePattern(p)) {
      if (typeof seg === 'string') {
        const n = next++
        edges.push({ from: cur, to: n, t: seg })
        cur = n
      } else {
        const end = next++
        for (const alt of seg) {
          const words = alt ? alt.split(/\s+/) : []
          let a = cur
          if (words.length === 0) {
            edges.push({ from: a, to: end, t: '' })
            continue
          }
          words.forEach((w, k) => {
            const to = k === words.length - 1 ? end : next++
            edges.push({ from: a, to, t: w })
            a = to
          })
        }
        cur = end
      }
    }
    accept.push(cur)
  }
  return { v: 1, start, accept, edges }
}

/** Enumerates accepted answers (display form, tokens joined by spaces), up to `limit`. */
export function enumerate(graph: AnswerGraph, limit = 1000): string[] {
  const out: string[] = []
  const acceptSet = new Set(graph.accept)
  const walk = (node: number, words: string[]) => {
    if (out.length >= limit) return
    if (acceptSet.has(node)) out.push(words.join(' '))
    for (const e of graph.edges) {
      if (e.from !== node) continue
      walk(e.to, e.t ? [...words, e.t] : words)
    }
  }
  walk(graph.start, [])
  return [...new Set(out)]
}

/** The first accepted answer: the canonical solution shown in feedback. */
export function canonical(graph: AnswerGraph): string {
  return enumerate(graph, 1)[0] ?? ''
}

function key(text: string, lang: Lang): string {
  return lang === 'fa' ? looseKey(text) : normalize(text).toLowerCase()
}

/** Grades an answer (typed text or word-bank tiles) against a compiled graph. */
export function grade(graph: AnswerGraph, answer: string | readonly string[], opts: GradeOptions): GradeResult {
  const text = typeof answer === 'string' ? answer : answer.join(' ')
  const candidates = enumerate(graph, 5000)
  const k = key(text, opts.lang)
  const hit = candidates.find((c) => key(c, opts.lang) === k)
  const closest = hit ?? candidates[0] ?? ''
  const answerTokens = normalize(text).split(' ').filter(Boolean)
  const diff: DiffToken[] = closest
    .split(' ')
    .filter(Boolean)
    .map((t, i) => ({ text: t, status: hit || answerTokens[i] === t ? 'ok' : 'wrong' }))
  return { verdict: hit ? 'correct' : 'wrong', closestSolution: closest, diff, graderVersion: GRADER_VERSION }
}

/** True when the answer is exactly accepted (after normalization). */
export function accepts(graph: AnswerGraph, answer: string | readonly string[], lang: Lang): boolean {
  return grade(graph, answer, { lang, mode: 'bank' }).verdict === 'correct'
}
