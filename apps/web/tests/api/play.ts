/** Scripted answers for any MVP challenge (what a perfect or a careless learner would send). */
import type { Challenge, ChallengeResponse } from '@zaboon/contracts'

type Graph = { start: number; accept: number[]; edges: { from: number; to: number; t: string }[] }

/** The first accepted path through an answer graph, as tokens. */
export function canonicalTokens(graph: Graph): string[] {
  const words: string[] = []
  const accept = new Set(graph.accept)
  let node = graph.start
  for (let guard = 0; !accept.has(node) && guard < 200; guard++) {
    const edge = graph.edges.find((e) => e.from === node)
    if (!edge) throw new Error('dead end in answer graph')
    if (edge.t) words.push(edge.t)
    node = edge.to
  }
  return words
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
      return { kind: 'tiles', value: canonicalTokens(c.graph) }
    case 'translate_type':
      return { kind: 'text', value: canonicalTokens(c.graph).join(' ') }
    case 'match_pairs':
    case 'letter_forms':
      return { kind: 'pairs', value: c.pairs.map((_, i) => [i, i] as [number, number]) }
    case 'letter_intro':
      return { kind: 'none' }
    case 'build_word':
      return { kind: 'tiles', value: [...c.answer] }
    default:
      throw new Error(`no scripted answer for ${c.type}`)
  }
}

/** A response the grader marks wrong (letter_intro can't be wrong: it gets a mismatched kind). */
export function wrongResponse(c: Challenge): ChallengeResponse {
  if ('answer' in c && typeof c.answer === 'number' && 'choices' in c)
    return { kind: 'choice', value: (c.answer + 1) % c.choices.length }
  return { kind: 'choice', value: 99 }
}

export interface Answer {
  index: number
  attemptSeq: number
  response: ChallengeResponse
  verdict: 'correct' | 'wrong' | 'skipped'
  ms: number
  hinted: boolean
}

/**
 * Answers for a session: every challenge correct on the first try, except `wrong` indexes, which are
 * answered wrong first and then correctly (a re-queued retry with its own attemptSeq).
 */
export function answersFor(
  challenges: readonly Challenge[],
  opts: { wrong?: readonly number[]; ms?: number } = {},
): Answer[] {
  const out: Answer[] = []
  let seq = 0
  const ms = opts.ms ?? 2000
  for (const c of challenges) {
    if (opts.wrong?.includes(c.index))
      out.push({
        index: c.index,
        attemptSeq: seq++,
        response: wrongResponse(c),
        verdict: 'wrong',
        ms,
        hinted: false,
      })
    out.push({
      index: c.index,
      attemptSeq: seq++,
      response: correctResponse(c),
      verdict: 'correct',
      ms,
      hinted: false,
    })
  }
  return out
}
