/**
 * @zaboon/grader: accepted-answer patterns → token DAG, and grading (docs/LEARNING-ENGINE.md §3, §7).
 * Runs on both client and server. Pure TypeScript, no DOM.
 *
 * - pattern.ts: the §3.1 pattern syntax;
 * - compile.ts: the DAG with automatic merges (register, pronoun drop, orthography variants);
 * - keys.ts / english.ts: comparison keys (Persian loose key; English contractions, spelling);
 * - classify.ts: token verdicts (typo, spelling, negation, lexicon);
 * - grade.ts: min-cost alignment over (DAG node × answer position), closest solution, diff.
 *
 * The oracle packages/grader/oracles/golden.yaml is the executable specification.
 */
import type { AnswerGraph } from '@zaboon/content-schema'
import { NORMALIZER_VERSION } from '@zaboon/farsi'
import { gradeText, type DiffToken, type GradeOptions, type Verdict } from './grade'
import type { Lang } from './keys'

export const IMPLEMENTATION: 'stub' | 'real' = 'real'
/** Grader logic revision: 1 = Wave 0 stub, 2 = min-cost alignment with typo/spelling verdicts. */
const GRADER_REVISION = 2
/** Increment on any change that can change a verdict. Clients report it; the server keeps a window. */
export const GRADER_VERSION = GRADER_REVISION + (NORMALIZER_VERSION - 1)

export type { Lang } from './keys'
export type { DiffToken, GradeOptions, Verdict } from './grade'
export { compile, MAX_EDGES, type CompileOptions } from './compile'
export { MAX_CELLS } from './grade'
export { classifyToken, type TokenMatch } from './classify'
export { keyTokens, editDistance, typoLimit } from './keys'
export { englishKeyTokens, englishNumberValue } from './english'

export interface GradeResult {
  verdict: Verdict
  /** Closest accepted answer, in the learner's register when known. */
  closestSolution: string
  /** Whole-word diff of the closest solution against the answer. */
  diff: DiffToken[]
  graderVersion: number
}

/** Enumerates accepted answers (display form, tokens joined by spaces), up to `limit`. */
export function enumerate(graph: AnswerGraph, limit = 1000): string[] {
  const out = new Set<string>()
  const acceptSet = new Set(graph.accept)
  const outgoing = new Map<number, AnswerGraph['edges']>()
  for (const e of graph.edges) outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e])
  const walk = (node: number, words: string[]) => {
    if (out.size >= limit) return
    if (acceptSet.has(node)) out.add(words.join(' '))
    for (const e of outgoing.get(node) ?? []) walk(e.to, e.t ? [...words, e.t] : words)
  }
  walk(graph.start, [])
  return [...out]
}

/** The first accepted answer: the canonical solution shown in feedback. */
export function canonical(graph: AnswerGraph): string {
  return enumerate(graph, 1)[0] ?? ''
}

/** Grades an answer (typed text or word-bank tiles) against a compiled graph. */
export function grade(graph: AnswerGraph, answer: string | readonly string[], opts: GradeOptions): GradeResult {
  const text = typeof answer === 'string' ? answer : answer.join(' ')
  return { ...gradeText(graph, text, opts), graderVersion: GRADER_VERSION }
}

/** True when the answer is exactly accepted (after normalization). */
export function accepts(graph: AnswerGraph, answer: string | readonly string[], lang: Lang): boolean {
  return grade(graph, answer, { lang, mode: 'bank' }).verdict === 'correct'
}
