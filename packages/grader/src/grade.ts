/**
 * Grading (docs/LEARNING-ENGINE.md §7.2): minimum-cost alignment between the answer's key tokens
 * and any path through the DAG, by dynamic programming over (DAG node × answer position).
 *
 * The serialized graph is first expanded into a key graph (cached per graph object): an edge whose
 * text has several key tokens (`I'd` → `i would`) becomes a chain, one with none (`؟`) an empty edge.
 */
import type { AnswerGraph } from '@zaboon/content-schema'
import { normalize } from '@zaboon/farsi'
import { classifyToken, type TokenMatch } from './classify'
import { keyTokens, type Lang } from './keys'

export type Verdict = 'correct' | 'typo' | 'spelling' | 'wrong'

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

export interface Alignment {
  verdict: Verdict
  closestSolution: string
  diff: DiffToken[]
}

// --- costs --------------------------------------------------------------------------------------

/** Missing, extra or wrong token. */
const WRONG = 1_000_000
const TYPO = 2_000
const SPELLING = 1_000
/** Tie-break: an edge into a node of the register the learner did not use. */
const OFF_REGISTER = 1

const MATCH_COST: Readonly<Record<TokenMatch, number>> = { exact: 0, spelling: SPELLING, typo: TYPO, wrong: WRONG }

/** DP cells (key nodes × answer positions) above which grading falls back to exact membership. */
export const MAX_CELLS = 2_000_000

// --- key graph ----------------------------------------------------------------------------------

const REG_NONE = 0
const REG_COLLOQUIAL = 1
const REG_FORMAL = 2

interface KeyEdge {
  to: number
  /** Key token, or null for an empty edge. */
  key: string | null
  /** Index of the serialized edge this key edge comes from. */
  orig: number
  /** True on the last key edge of its serialized edge. */
  last: boolean
}

interface KeyGraph {
  size: number
  start: number
  accept: Set<number>
  out: KeyEdge[][]
  order: number[]
  register: Uint8Array
}

const cache = new WeakMap<AnswerGraph, Partial<Record<Lang, KeyGraph>>>()

function keyGraph(graph: AnswerGraph, lang: Lang): KeyGraph {
  let perLang = cache.get(graph)
  if (!perLang) cache.set(graph, (perLang = {}))
  return (perLang[lang] ??= buildKeyGraph(graph, lang))
}

function buildKeyGraph(graph: AnswerGraph, lang: Lang): KeyGraph {
  const ids = new Map<number, number>()
  const dense = (n: number) => {
    let d = ids.get(n)
    if (d === undefined) ids.set(n, (d = ids.size))
    return d
  }
  const start = dense(graph.start)
  const out: KeyEdge[][] = []
  const add = (from: number, e: KeyEdge) => {
    while (out.length <= Math.max(from, e.to)) out.push([])
    out[from]!.push(e)
  }
  let extra = 0
  const pending: [number, KeyEdge][] = []
  graph.edges.forEach((e, orig) => {
    const from = dense(e.from)
    const to = dense(e.to)
    const keys = keyTokens(e.t, lang)
    if (keys.length === 0) pending.push([from, { to, key: null, orig, last: true }])
    keys.forEach((key, i) => {
      const last = i === keys.length - 1
      // Intermediate nodes get negative placeholders, renumbered after all real nodes.
      const src = i === 0 ? from : -(extra + i)
      const dst = last ? to : -(extra + i + 1)
      pending.push([src, { to: dst, key, orig, last }])
    })
    if (keys.length > 1) extra += keys.length - 1
  })
  for (const a of graph.accept) dense(a)
  const base = ids.size
  const fix = (n: number) => (n < 0 ? base - n - 1 : n)
  for (const [from, e] of pending) add(fix(from), { ...e, to: fix(e.to) })
  const size = Math.max(base + extra, out.length)
  while (out.length < size) out.push([])

  const register = new Uint8Array(size)
  for (const [node, reg] of Object.entries(graph.registers ?? {})) {
    const d = ids.get(Number(node))
    if (d !== undefined) register[d] = reg === 'formal' ? REG_FORMAL : REG_COLLOQUIAL
  }
  // Intermediate key nodes inherit the register of their serialized edge's target.
  for (let u = 0; u < size; u++)
    for (const e of out[u]!) if (!e.last && register[e.to] === REG_NONE) register[e.to] = register[fix(dense(graph.edges[e.orig]!.to))]!

  // Kahn topological order; a cycle is a malformed graph.
  const indeg = new Uint32Array(size)
  for (const edges of out) for (const e of edges) indeg[e.to]!++
  const order: number[] = []
  const queue: number[] = []
  for (let u = 0; u < size; u++) if (indeg[u] === 0) queue.push(u)
  while (queue.length) {
    const u = queue.shift()!
    order.push(u)
    for (const e of out[u]!) if (--indeg[e.to]! === 0) queue.push(e.to)
  }
  if (order.length !== size) throw new Error('grade: answer graph has a cycle')

  return { size, start, accept: new Set(graph.accept.map((a) => ids.get(a)!)), out, order, register }
}

// --- alignment ----------------------------------------------------------------------------------

const OP_NONE = 0
const OP_EMPTY = 1
const OP_MATCH = 2
const OP_MISSING = 3
const OP_EXTRA = 4

interface Step {
  op: typeof OP_EMPTY | typeof OP_MATCH | typeof OP_MISSING | typeof OP_EXTRA
  edge: KeyEdge | null
  answer: number
  match: TokenMatch
}

interface Path {
  cost: number
  steps: Step[]
}

/** Minimum-cost alignment; `prefer` is the register whose nodes cost nothing extra. */
function align(kg: KeyGraph, answer: readonly string[], classify: (a: string, k: string) => TokenMatch, prefer: number): Path | null {
  const n = answer.length
  const width = n + 1
  const cells = kg.size * width
  const cost = new Float64Array(cells).fill(Number.POSITIVE_INFINITY)
  const prevCell = new Int32Array(cells).fill(-1)
  const op = new Uint8Array(cells)
  const via = new Array<KeyEdge | null>(cells).fill(null)
  const how = new Array<TokenMatch>(cells)
  cost[kg.start * width] = 0

  const relax = (cell: number, c: number, from: number, o: number, e: KeyEdge | null, m: TokenMatch) => {
    if (c < cost[cell]!) {
      cost[cell] = c
      prevCell[cell] = from
      op[cell] = o
      via[cell] = e
      how[cell] = m
    }
  }
  for (const u of kg.order) {
    const row = u * width
    for (let j = 0; j < n; j++) {
      const c = cost[row + j]!
      if (c !== Number.POSITIVE_INFINITY) relax(row + j + 1, c + WRONG, row + j, OP_EXTRA, null, 'wrong')
    }
    for (const e of kg.out[u]!) {
      const reg = kg.register[e.to]!
      const tie = reg !== REG_NONE && reg !== prefer ? OFF_REGISTER : 0
      const vrow = e.to * width
      for (let j = 0; j <= n; j++) {
        const c = cost[row + j]!
        if (c === Number.POSITIVE_INFINITY) continue
        if (e.key === null) {
          relax(vrow + j, c + tie, row + j, OP_EMPTY, e, 'exact')
          continue
        }
        relax(vrow + j, c + WRONG + tie, row + j, OP_MISSING, e, 'wrong')
        if (j < n) {
          const m = classify(answer[j]!, e.key)
          relax(vrow + j + 1, c + MATCH_COST[m] + tie, row + j, OP_MATCH, e, m)
        }
      }
    }
  }

  let best = -1
  for (const a of kg.accept) {
    const cell = a * width + n
    if (best < 0 || cost[cell]! < cost[best]!) best = cell
  }
  if (best < 0 || cost[best] === Number.POSITIVE_INFINITY) return null
  const steps: Step[] = []
  for (let cell = best; prevCell[cell]! >= 0; cell = prevCell[cell]!) {
    const o = op[cell]!
    if (o === OP_NONE) break
    steps.push({ op: o as Step['op'], edge: via[cell]!, answer: (cell % width) - (o === OP_MATCH || o === OP_EXTRA ? 1 : 0), match: how[cell]! })
  }
  steps.reverse()
  return { cost: cost[best]!, steps }
}

/** Counts exact matches on each register's nodes, to find the register the learner used. */
function learnerRegister(kg: KeyGraph, path: Path): number {
  let formal = 0
  let colloquial = 0
  for (const s of path.steps) {
    if (s.op !== OP_MATCH || s.match !== 'exact') continue
    const reg = kg.register[s.edge!.to]
    if (reg === REG_FORMAL) formal++
    else if (reg === REG_COLLOQUIAL) colloquial++
  }
  return formal > colloquial ? REG_FORMAL : REG_COLLOQUIAL
}

const SEVERITY: Readonly<Record<Verdict, number>> = { correct: 0, spelling: 1, typo: 2, wrong: 3 }

function render(graph: AnswerGraph, path: Path, answerDisplay: readonly string[], bank: boolean): Alignment {
  const diff: DiffToken[] = []
  const solution: string[] = []
  let verdict: Verdict = 'correct'
  const worse = (v: Verdict) => {
    if (SEVERITY[v] > SEVERITY[verdict]) verdict = v
  }
  let group: DiffToken['status'][] = []
  const flush = (orig: number) => {
    const text = graph.edges[orig]!.t
    const statuses = group
    group = []
    if (!text) return
    solution.push(text)
    let status: DiffToken['status'] = 'ok'
    if (statuses.every((s) => s === 'missing') && statuses.length > 0) status = 'missing'
    else if (statuses.some((s) => s === 'wrong' || s === 'missing')) status = 'wrong'
    else if (statuses.includes('typo')) status = 'typo'
    else if (statuses.includes('spelling')) status = 'spelling'
    diff.push({ text, status })
  }
  for (const s of path.steps) {
    switch (s.op) {
      case OP_EXTRA:
        worse('wrong')
        diff.push({ text: answerDisplay[s.answer] ?? '', status: 'extra' })
        break
      case OP_MISSING:
        worse('wrong')
        group.push('missing')
        break
      case OP_MATCH: {
        const m = bank && s.match !== 'exact' ? 'wrong' : s.match
        worse(m === 'exact' ? 'correct' : m)
        group.push(m === 'exact' ? 'ok' : m)
        break
      }
      case OP_EMPTY:
        break
    }
    if (s.edge && s.edge.last) flush(s.edge.orig)
  }
  return { verdict, closestSolution: solution.join(' '), diff }
}

/** Grades answer text against a graph. */
export function gradeText(graph: AnswerGraph, text: string, opts: GradeOptions): Alignment {
  const { lang } = opts
  const kg = keyGraph(graph, lang)
  const answer = keyTokens(text, lang)
  const strict = normalize(text).split(' ').filter(Boolean)
  const answerDisplay = strict.length === answer.length ? strict : answer
  const bank = opts.mode === 'bank'

  const lexicon = new Set((opts.lexicon ?? []).map((w) => keyTokens(w, lang).join(' ')))
  const memo = new Map<string, TokenMatch>()
  const classify = (a: string, k: string): TokenMatch => {
    const id = `${a}\u0000${k}`
    let m = memo.get(id)
    if (m === undefined) memo.set(id, (m = bank ? (classifyToken(a, k, lang, new Set()) === 'exact' ? 'exact' : 'wrong') : classifyToken(a, k, lang, lexicon)))
    return m
  }

  if (kg.size * (answer.length + 1) > MAX_CELLS) return fallback(graph, kg, answer, classify)

  let path = align(kg, answer, classify, REG_COLLOQUIAL)
  if (!path) return { verdict: 'wrong', closestSolution: '', diff: [] }
  if (graph.registers && learnerRegister(kg, path) === REG_FORMAL) path = align(kg, answer, classify, REG_FORMAL) ?? path
  return render(graph, path, answerDisplay, bank)
}

/**
 * Guard for huge graphs: exact membership by simulating the key graph as an automaton
 * (O(nodes × tokens)); no leniency, and the canonical path as the closest solution.
 */
function fallback(graph: AnswerGraph, kg: KeyGraph, answer: readonly string[], classify: (a: string, k: string) => TokenMatch): Alignment {
  const closure = (set: Set<number>) => {
    const stack = [...set]
    while (stack.length) {
      const u = stack.pop()!
      for (const e of kg.out[u]!) {
        if (e.key !== null || set.has(e.to)) continue
        set.add(e.to)
        stack.push(e.to)
      }
    }
    return set
  }
  let states = closure(new Set([kg.start]))
  for (const tok of answer) {
    const next = new Set<number>()
    for (const u of states) for (const e of kg.out[u]!) if (e.key !== null && classify(tok, e.key) === 'exact') next.add(e.to)
    states = closure(next)
    if (states.size === 0) break
  }
  const ok = [...states].some((s) => kg.accept.has(s))
  const first: string[] = []
  const walk = (node: number): boolean => {
    if (graph.accept.includes(node)) return true
    for (const e of graph.edges) {
      if (e.from !== node) continue
      if (walk(e.to)) {
        if (e.t) first.unshift(e.t)
        return true
      }
    }
    return false
  }
  walk(graph.start)
  return {
    verdict: ok ? 'correct' : 'wrong',
    closestSolution: first.join(' '),
    diff: first.map((text) => ({ text, status: ok ? 'ok' : 'wrong' })),
  }
}
