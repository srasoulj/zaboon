/**
 * Pure helpers for the golden-path spec (no Playwright): the contract shapes it reads, and how the
 * correct answer is derived from a challenge (components/challenges/fixtures/samples.ts logic),
 * plus copies of the renderers' display-order helpers. Kept apart from golden.spec.ts so it can be
 * checked against the real grader offline.
 */

// ------------------------------------------------ contract shapes (packages/contracts/src/schemas.ts)
export interface Graph {
  start: number
  accept: number[]
  edges: { from: number; to: number; t: string }[]
}
export interface FaTextDto {
  fa: string
  translit: string
  faVocalized?: string
}
export type Challenge = { index: number } & (
  | {
      type: 'select_image'
      prompt: FaTextDto
      choices: { lexeme: string; image: string; label: string }[]
      answer: number
    }
  | {
      type: 'select_translation'
      direction: string
      choices: { lang: 'fa' | 'en'; text: string; fa?: FaTextDto }[]
      answer: number
    }
  | { type: 'cloze_choice'; choices: string[]; answer: number; translation: string }
  | { type: 'complete_chat'; choices: (FaTextDto & { en: string })[]; answer: number }
  | { type: 'letter_sound'; mode: string; choices: string[]; answer: number }
  | { type: 'read_word'; ask: string; choices: string[]; answer: number }
  | {
      type: 'translate_bank'
      direction: string
      answerLang: 'fa' | 'en'
      bank: string[]
      graph: Graph
    }
  | { type: 'listen_tap'; bank: string[]; graph: Graph }
  | { type: 'translate_type'; direction: string; answerLang: 'fa' | 'en'; graph: Graph }
  | { type: 'match_pairs'; pairs: { fa: FaTextDto; en: string }[] }
  | { type: 'letter_forms'; pairs: { left: string; right: string }[] }
  | { type: 'letter_intro'; letter: { letter: string; name: string } }
  | { type: 'build_word'; target: FaTextDto & { en: string }; tiles: string[]; answer: string[] }
)
export type ChoiceChallenge = Extract<Challenge, { answer: number }>

export type ChallengeResponse =
  | { kind: 'choice'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'tiles'; value: string[] }
  | { kind: 'pairs'; value: [number, number][] }
  | { kind: 'none' }

// ---------------------------------------------------- correct answers (fixtures/samples.ts logic)
/** Loose token key for matching bank words to graph edges (punctuation and case ignored). */
const tokenKey = (t: string) =>
  t
    .replace(/[.,!?؟،؛«»]/g, '')
    .trim()
    .toLowerCase()

/**
 * A path from start to an accepting node whose words all come from `bank` (each tile once, bank
 * spelling), or, without a bank, the first accepted path (the grader's canonical answer).
 */
export function solveGraph(graph: Graph, bank?: readonly string[]): string[] | null {
  const accept = new Set(graph.accept)
  const walk = (
    node: number,
    left: readonly string[] | undefined,
    depth: number,
  ): string[] | null => {
    if (accept.has(node)) return []
    if (depth > 40) return null
    for (const e of graph.edges.filter((x) => x.from === node)) {
      if (e.t === '') {
        const rest = walk(e.to, left, depth + 1)
        if (rest) return rest
        continue
      }
      if (left === undefined) {
        const rest = walk(e.to, undefined, depth + 1)
        if (rest) return [e.t, ...rest]
        continue
      }
      const i = left.findIndex((w) => tokenKey(w) === tokenKey(e.t))
      if (i < 0) continue
      const rest = walk(e.to, [...left.slice(0, i), ...left.slice(i + 1)], depth + 1)
      if (rest) return [left[i]!, ...rest]
    }
    return null
  }
  return walk(graph.start, bank, 0)
}

/** The response the grader accepts (what the spec's UI actions produce). */
export function correctResponse(c: Challenge): ChallengeResponse {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      return { kind: 'choice', value: c.answer }
    case 'translate_bank':
    case 'listen_tap':
      return { kind: 'tiles', value: solveGraph(c.graph, c.bank) ?? [] }
    case 'build_word':
      return { kind: 'tiles', value: c.answer }
    case 'translate_type':
      return { kind: 'text', value: (solveGraph(c.graph) ?? []).join(' ') }
    case 'match_pairs':
    case 'letter_forms':
      return { kind: 'pairs', value: c.pairs.map((_, i) => [i, i] as [number, number]) }
    case 'letter_intro':
      return { kind: 'none' }
  }
}

/** The text of the correct choice as the session carries it. */
export function choiceLabel(c: ChoiceChallenge): string {
  switch (c.type) {
    case 'select_image':
      return c.choices[c.answer]?.label ?? '?'
    case 'select_translation': {
      const ch = c.choices[c.answer]
      return ch ? (ch.fa?.fa ?? ch.text) : '?'
    }
    case 'complete_chat':
      return c.choices[c.answer]?.fa ?? '?'
    case 'cloze_choice':
    case 'letter_sound':
    case 'read_word':
      return c.choices[c.answer] ?? '?'
  }
}

export function describeAnswer(c: Challenge): string {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      return `choice ${c.answer + 1} "${choiceLabel(c)}"`
    case 'translate_bank':
    case 'listen_tap':
      return `tiles ${JSON.stringify(solveGraph(c.graph, c.bank))}`
    case 'translate_type':
      return `type "${(solveGraph(c.graph) ?? []).join(' ')}"`
    case 'match_pairs':
      return `pairs ${c.pairs.map((p) => `${p.fa.fa}=${p.en}`).join(', ')}`
    case 'letter_forms':
      return `pairs ${c.pairs.map((p) => `${p.left}=${p.right}`).join(', ')}`
    case 'letter_intro':
      return `nothing to answer (letter ${c.letter.letter})`
    case 'build_word':
      return `letters ${c.answer.join(' + ')} (${c.target.en})`
  }
}

/** Tile positions spelling `values`: each value takes the first unused tile (shared.tsx idsForValues). */
export function tileIndexes(tiles: readonly string[], values: readonly string[]): number[] {
  const used = new Set<number>()
  const out: number[] = []
  for (const v of values) {
    const i = tiles.findIndex((t, k) => t === v && !used.has(k))
    if (i < 0) continue
    used.add(i)
    out.push(i)
  }
  return out
}

/** components/challenges/shared.tsx `seededOrder` (display order of the matching columns). */
export function seededOrder(count: number, seed: string): number[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  const order = Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

/** The seed MatchPairs / LetterForms give MatchColumns (the columns add ':l' / ':r'). */
export function matchSeed(c: Extract<Challenge, { type: 'match_pairs' | 'letter_forms' }>): string {
  return c.type === 'match_pairs'
    ? `${c.index}:${c.pairs.map((p) => p.en).join('|')}`
    : `${c.index}:${c.pairs.map((p) => p.right).join('|')}`
}

/** Persian text as shown, compared without vowel marks (FaText strips/keeps them per setting). */
export const plain = (s: string) =>
  s
    .replace(/[ً-ْٰ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** lib/lesson/summary.ts formatDuration. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
