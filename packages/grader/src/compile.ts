/**
 * Compiles accepted-answer patterns into one token DAG (docs/LEARNING-ENGINE.md §3.2).
 *
 * Automatic merges:
 * 1. Normalization is not baked in: edges keep the authored display form and the grader compares
 *    keys (keys.ts), so the same graph renders solutions and word-bank tiles.
 * 2. Register: when `formal` has as many slots as a pattern, each differing formal token becomes an
 *    alternative in that slot (so mixed register is accepted); otherwise it is an extra pattern.
 * 3. Pronoun drop (Persian): a sentence-initial subject pronoun slot gets an empty alternative.
 * 4. Orthography variants: every occurrence of a variant's token sequence on a DAG path gets the
 *    other members as parallel paths (symmetric; a member may span several tokens).
 * 5. English contractions, US/UK spelling and number words are key-level (grade time).
 *
 * Register bookkeeping: `graph.registers` maps a node id (decimal string) to the register of every
 * path through that node. Register-specific tokens end on such a node (followed by an empty edge
 * when they rejoin a shared slot), which lets the grader render the closest solution in the
 * register the learner used.
 */
import type { AnswerGraph, Register } from '@zaboon/content-schema'
import { LOOSE_PREFIXES, LOOSE_SUFFIXES, looseKey } from '@zaboon/farsi'
import { DROPPABLE_PRONOUNS, keyTokens, type Lang } from './keys'
import { parsePattern, type Segment } from './pattern'

export interface CompileOptions {
  lang: Lang
  /** The item's faFormal: merged as a register alternative (Persian only). */
  formal?: string
  /** Sentence-initial subject pronoun becomes optional (Persian only). Default true. */
  pronounDrop?: boolean
  /** Course-wide orthography variant sets. */
  variants?: readonly (readonly string[])[]
}

/** Hard cap on compiled edges: larger graphs are an authoring error (§3.3 limits paths to 5,000). */
export const MAX_EDGES = 20_000

type Edge = AnswerGraph['edges'][number]

class Builder {
  readonly edges: Edge[] = []
  readonly registers: Record<string, Register> = {}
  next = 1

  node(register?: Register): number {
    const n = this.next++
    if (register) this.registers[String(n)] = register
    return n
  }

  edge(from: number, to: number, t: string): void {
    if (this.edges.length >= MAX_EDGES)
      throw new Error(`compile: answer graph exceeds ${MAX_EDGES} edges`)
    this.edges.push({ from, to, t })
  }

  /** A chain of words from `from` to `to` (an empty edge for no words). */
  path(from: number, to: number, words: readonly string[], register?: Register): void {
    if (words.length === 0) {
      this.edge(from, to, '')
      return
    }
    let cur = from
    words.forEach((w, i) => {
      const n = i === words.length - 1 ? to : this.node(register)
      this.edge(cur, n, w)
      cur = n
    })
  }
}

/** Persian: a standalone affix word joins its neighbor (کتاب ها → one token), like the loose key. */
function mergeAffixWords(words: readonly string[], lang: Lang): string[] {
  if (lang !== 'fa') return [...words]
  const out: string[] = []
  let glueNext = false
  for (const w of words) {
    const k = looseKey(w)
    if (out.length > 0 && (glueNext || LOOSE_SUFFIXES.has(k))) out[out.length - 1] += ` ${w}`
    else out.push(w)
    glueNext = LOOSE_PREFIXES.has(k)
  }
  return out
}

/** Applies `mergeAffixWords` inside alternatives and across consecutive plain-word slots. */
function mergeAffixSegments(segments: readonly Segment[], lang: Lang): Segment[] {
  const out: Segment[] = []
  let run: string[] = []
  const flush = () => {
    for (const w of mergeAffixWords(run, lang)) out.push({ alts: [[w]], group: false })
    run = []
  }
  for (const s of segments) {
    if (s.group) {
      flush()
      out.push({ alts: s.alts.map((a) => mergeAffixWords(a, lang)), group: true })
    } else run.push(s.alts[0]![0]!)
  }
  flush()
  return out
}

const keyOf = (words: readonly string[], lang: Lang) => keyTokens(words.join(' '), lang).join(' ')

export function compile(patterns: readonly string[], opts: CompileOptions): AnswerGraph {
  const { lang } = opts
  if (patterns.length === 0) throw new Error('compile: no patterns')
  const parsed = patterns.map((p) => mergeAffixSegments(parsePattern(p), lang))

  // Register: align the formal sentence slot by slot with the first pattern of the same length.
  let formalSlots: (string | null)[] | null = null
  let formalTarget = -1
  let formalPattern: Segment[] | null = null
  if (lang === 'fa' && opts.formal !== undefined) {
    const f = mergeAffixSegments(parsePattern(opts.formal), lang)
    formalTarget = parsed.findIndex((segs) => segs.length === f.length)
    if (formalTarget >= 0 && f.every((s) => !s.group)) {
      formalSlots = f.map((s, i) => {
        const word = s.alts[0]![0]!
        const k = keyOf([word], lang)
        return parsed[formalTarget]![i]!.alts.some((a) => keyOf(a, lang) === k) ? null : word
      })
    } else {
      formalTarget = -1
      formalPattern = f
    }
  }

  const b = new Builder()
  const start = 0
  const accept: number[] = []
  const hasRegisters = opts.formal !== undefined && lang === 'fa'
  const build = (
    segs: readonly Segment[],
    slots: readonly (string | null)[] | null,
    tagAll?: Register,
  ) => {
    let cur = start
    segs.forEach((seg, i) => {
      const end = b.node(tagAll)
      const formalWord = slots?.[i] ?? null
      if (formalWord === null) {
        for (const alt of seg.alts) b.path(cur, end, alt, tagAll)
      } else {
        const colloquial = b.node('colloquial')
        for (const alt of seg.alts) b.path(cur, colloquial, alt, 'colloquial')
        b.edge(colloquial, end, '')
        const formal = b.node('formal')
        b.edge(cur, formal, formalWord)
        b.edge(formal, end, '')
      }
      if (i === 0 && segs.length > 1 && lang === 'fa' && opts.pronounDrop !== false) {
        const pronounSlot = seg.alts.some(
          (a) => a.length === 1 && DROPPABLE_PRONOUNS.has(keyOf(a, lang)),
        )
        if (pronounSlot) b.edge(cur, end, '')
      }
      cur = end
    })
    if (segs.length === 0) {
      const end = b.node(tagAll)
      b.edge(start, end, '')
      cur = end
    }
    accept.push(cur)
  }
  parsed.forEach((segs, i) =>
    build(
      segs,
      i === formalTarget ? formalSlots : null,
      formalPattern && hasRegisters ? 'colloquial' : undefined,
    ),
  )
  if (formalPattern) build(formalPattern, null, 'formal')

  for (const set of opts.variants ?? []) applyVariantSet(b, set, lang)

  const graph: AnswerGraph = { v: 1, start, accept: [...new Set(accept)], edges: b.edges }
  if (hasRegisters && Object.keys(b.registers).length > 0) graph.registers = b.registers
  return graph
}

/**
 * Finds every path whose tokens spell one member of the set (compared by key) and adds the other
 * members as parallel paths between the same two nodes.
 */
function applyVariantSet(b: Builder, set: readonly string[], lang: Lang): void {
  const members = set
    .map((m) => ({
      words: mergeAffixWords(m.trim().split(/\s+/).filter(Boolean), lang),
      key: keyTokens(m, lang),
    }))
    .filter((m) => m.key.length > 0)
  if (members.length < 2) return
  const edgeKeys = b.edges.map((e) => keyTokens(e.t, lang))
  const out = new Map<number, number[]>()
  b.edges.forEach((e, i) => out.set(e.from, [...(out.get(e.from) ?? []), i]))

  const found: { from: number; to: number; member: number }[] = []
  const nodes = new Set([0, ...b.edges.map((e) => e.to)])
  members.forEach((m, mi) => {
    for (const from of nodes) {
      // Depth-first match of m.key from `from`; empty edges are crossed only inside a match.
      const stack: [number, number][] = [[from, 0]]
      const seen = new Set<string>()
      while (stack.length) {
        const [node, pos] = stack.pop()!
        const id = `${node}:${pos}`
        if (seen.has(id)) continue
        seen.add(id)
        if (pos === m.key.length) {
          found.push({ from, to: node, member: mi })
          continue
        }
        for (const ei of out.get(node) ?? []) {
          const k = edgeKeys[ei]!
          if (k.length === 0) {
            if (pos > 0) stack.push([b.edges[ei]!.to, pos])
            continue
          }
          if (k.every((tok, j) => m.key[pos + j] === tok))
            stack.push([b.edges[ei]!.to, pos + k.length])
        }
      }
    }
  })

  const added = new Set(found.map((f) => `${f.from}>${f.to}>${f.member}`))
  for (const f of found) {
    members.forEach((m, mi) => {
      const id = `${f.from}>${f.to}>${mi}`
      if (added.has(id)) return
      added.add(id)
      b.path(f.from, f.to, m.words)
    })
  }
}
