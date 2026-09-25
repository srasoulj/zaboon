/**
 * Sample drafts for a built challenge: one the grader accepts and one it rejects. Used by the dev
 * gallery (feedback states) and the renderer tests. Not used by the player.
 */
import type { AnswerGraph, Challenge, ChallengeResponse } from '@zaboon/contracts'

/** Loose token key for matching bank words to graph edges (punctuation and case ignored). */
const key = (t: string) =>
  t
    .replace(/[.,!?؟،؛«»]/g, '')
    .trim()
    .toLowerCase()

/**
 * A path from start to an accepting node whose words all come from `bank` (each tile used once),
 * or, without a bank, any accepted path. Returns the words in order (bank spelling), or null.
 */
export function solveGraph(graph: AnswerGraph, bank?: readonly string[]): string[] | null {
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
      const i = left.findIndex((w) => key(w) === key(e.t))
      if (i < 0) continue
      const rest = walk(e.to, [...left.slice(0, i), ...left.slice(i + 1)], depth + 1)
      if (rest) return [left[i]!, ...rest]
    }
    return null
  }
  return walk(graph.start, bank, 0)
}

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
    default:
      return { kind: 'skip' }
  }
}

export function wrongResponse(c: Challenge): ChallengeResponse {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      return { kind: 'choice', value: (c.answer + 1) % c.choices.length }
    case 'translate_bank':
    case 'listen_tap':
      return { kind: 'tiles', value: [...(solveGraph(c.graph, c.bank) ?? [])].reverse() }
    case 'build_word':
      return { kind: 'tiles', value: [...c.answer].reverse() }
    case 'translate_type':
      return { kind: 'text', value: 'I am a teapot' }
    default:
      // Matching can only produce correct pairs; letter_intro has nothing to get wrong.
      return correctResponse(c)
  }
}
