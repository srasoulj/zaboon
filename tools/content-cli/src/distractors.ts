/**
 * Distractor safety (LEARNING-ENGINE §3.3, §4.3): no distractor may form a valid answer.
 *
 * - Pinned `distractors` (select_image, select_translation, cloze_choice, …): a distractor item
 *   must not be interchangeable with the target (same Persian, a shared gloss or image, or an
 *   answer the target's graph accepts).
 * - Word-bank tiles (translate_bank, listen_tap): the tiles are the canonical answer's words plus
 *   distractor words from the course vocabulary (Persian: lexeme `fa`; English: first gloss, as the
 *   session engine draws them). A distractor tile is unsafe when some accepted answer can be built
 *   from the answer's words plus distractor tiles and needs at least one distractor to do so.
 */
import { accepts, canonical, enumerate, type Lang } from '@zaboon/grader'
import { looseKey, normalize } from '@zaboon/farsi'
import type { AnswerGraph, Lexeme, Sentence } from '@zaboon/content-schema'

const tileKey = (w: string, lang: Lang) =>
  lang === 'fa' ? looseKey(w) : normalize(w).toLowerCase()

/**
 * The distractor tiles in `pool` that can complete an accepted answer other than by the canonical
 * words alone. Multi-word pool entries count word by word (conservative).
 */
export function unsafeBankTiles(
  graph: AnswerGraph,
  lang: Lang,
  pool: readonly string[],
  limit = 5000,
): string[] {
  const answer = canonical(graph)
  const base = new Map<string, number>()
  for (const w of answer.split(' ').filter(Boolean)) {
    const k = tileKey(w, lang)
    base.set(k, (base.get(k) ?? 0) + 1)
  }
  const poolByKey = new Map<string, string[]>()
  for (const tile of pool) {
    for (const w of tile.split(/\s+/).filter(Boolean)) {
      const k = tileKey(w, lang)
      if (!k) continue
      poolByKey.set(k, [...(poolByKey.get(k) ?? []), tile])
    }
  }
  const unsafe = new Set<string>()
  for (const path of enumerate(graph, limit)) {
    const need = new Map(base)
    const extra: string[] = []
    for (const w of path.split(' ').filter(Boolean)) {
      const k = tileKey(w, lang)
      const left = need.get(k) ?? 0
      if (left > 0) need.set(k, left - 1)
      else extra.push(k)
    }
    if (extra.length === 0) continue
    if (extra.every((k) => poolByKey.has(k)))
      for (const k of extra) for (const tile of poolByKey.get(k)!) unsafe.add(tile)
  }
  return [...unsafe].sort()
}

/** The engine's default bank pool for an answer language: lexemes known at that unit. */
export function bankPool(lexemes: readonly Lexeme[], lang: Lang): string[] {
  return lang === 'fa' ? lexemes.map((l) => l.fa) : lexemes.flatMap((l) => l.glosses.slice(0, 1))
}

const glossKey = (g: string) =>
  g
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, '')

/** Why lexeme `d` could also be a correct answer where `target` is asked, or null. */
export function lexemeConflict(
  target: Lexeme,
  d: Lexeme,
  opts: { image?: boolean } = {},
): string | null {
  if (target.id === d.id) return 'it is the target itself'
  if (looseKey(target.fa) === looseKey(d.fa)) return `same Persian "${d.fa}"`
  const glosses = new Set(target.glosses.map(glossKey))
  const shared = d.glosses.find((g) => glosses.has(glossKey(g)))
  if (shared) return `shared gloss "${shared}"`
  if (opts.image && target.image && target.image === d.image) return `same image ${d.image}`
  return null
}

/** Why sentence `d` could also be a correct answer where `target` is asked, or null. */
export function sentenceConflict(
  target: { s: Sentence; en: AnswerGraph; fa: AnswerGraph },
  d: { s: Sentence; en: AnswerGraph; fa: AnswerGraph },
): string | null {
  if (target.s.id === d.s.id) return 'it is the target itself'
  if (accepts(target.fa, d.s.fa, 'fa') || accepts(d.fa, target.s.fa, 'fa'))
    return `its Persian "${d.s.fa}" is an accepted answer`
  const dEn = canonical(d.en)
  if (accepts(target.en, dEn, 'en') || accepts(d.en, canonical(target.en), 'en'))
    return `its English "${dEn}" is an accepted answer`
  return null
}
