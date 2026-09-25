/**
 * Read-side helpers over a ContentView: id lookups, DTO shapes and answer-key utilities shared by
 * the builders and the planner. The index is memoized per ContentView object.
 */
import type {
  CharactersBundle,
  Chat,
  CompiledSentence,
  Letter,
  LettersBundle,
  Lexeme,
  Manifest,
  UnitBundle,
} from '@zaboon/content-schema'
import type { AnswerGraph, FaTextDto, LetterInfo } from '@zaboon/contracts'
import { letterForms, looseKey, normalize } from '@zaboon/farsi'
import { canonical, compile } from '@zaboon/grader'

/** Everything the engine may read. Built by the app server from immutable bundle vN. */
export interface ContentView {
  manifest: Manifest
  /** The unit that owns the level (null for letters-only sessions). */
  unit: UnitBundle | null
  letters: LettersBundle
  characters: CharactersBundle
  /** All lexemes introduced up to and including the current unit (distractors, spelling lexicon). */
  knownLexemes: readonly Lexeme[]
  /** All compiled sentences up to and including the current unit. */
  knownSentences: readonly CompiledSentence[]
  /** Resolves a content-relative media ref (e.g. "audio/lx_ab.mp3") to a URL. */
  mediaUrl(ref: string): string
}

export class ContentError extends Error {}

export interface ContentIndex {
  view: ContentView
  lexemes: ReadonlyMap<string, Lexeme>
  sentences: ReadonlyMap<string, CompiledSentence>
  chats: ReadonlyMap<string, Chat>
  letters: ReadonlyMap<string, Letter>
  /** Lexemes in a stable order: known lexemes, then unit, then letter examples (deduplicated). */
  lexemeList: readonly Lexeme[]
  sentenceList: readonly CompiledSentence[]
  letterList: readonly Letter[]
  characterName(id: string): string
  /** The character's portrait as a media URL, when the course has one. */
  characterImage(id: string): string | undefined
  lexeme(id: string): Lexeme
  sentence(id: string): CompiledSentence
  chat(id: string): Chat
  letter(id: string): Letter
}

const cache = new WeakMap<ContentView, ContentIndex>()

function byId<T extends { id: string }>(
  lists: readonly (readonly T[])[],
): { map: Map<string, T>; list: T[] } {
  const map = new Map<string, T>()
  for (const list of lists) for (const item of list) if (!map.has(item.id)) map.set(item.id, item)
  return { map, list: [...map.values()] }
}

export function indexContent(view: ContentView): ContentIndex {
  const hit = cache.get(view)
  if (hit) return hit
  const lx = byId<Lexeme>([view.knownLexemes, view.unit?.lexemes ?? [], view.letters.lexemes])
  const st = byId<CompiledSentence>([view.knownSentences, view.unit?.sentences ?? []])
  const ch = byId<Chat>([view.unit?.chats ?? []])
  const le = byId<Letter>([[...view.letters.track.letters].sort((a, b) => a.order - b.order)])
  const names = new Map(view.characters.characters.map((c) => [c.id, c.name]))
  const images = new Map(
    view.characters.characters.flatMap((c) => (c.image ? [[c.id, c.image] as const] : [])),
  )
  const need =
    <T>(map: Map<string, T>, kind: string) =>
    (id: string): T => {
      const v = map.get(id)
      if (v === undefined) throw new ContentError(`unknown ${kind} ${id}`)
      return v
    }
  const index: ContentIndex = {
    view,
    lexemes: lx.map,
    sentences: st.map,
    chats: ch.map,
    letters: le.map,
    lexemeList: lx.list,
    sentenceList: st.list,
    letterList: le.list,
    characterName: (id) => names.get(id) ?? id,
    characterImage: (id) => {
      const ref = images.get(id)
      return ref === undefined ? undefined : view.mediaUrl(ref)
    },
    lexeme: need(lx.map, 'lexeme'),
    sentence: need(st.map, 'sentence'),
    chat: need(ch.map, 'chat'),
    letter: need(le.map, 'letter'),
  }
  cache.set(view, index)
  return index
}

// ------------------------------------------------------------------------------------------- DTOs
/** Drops undefined properties so built challenges are JSON-stable (rebuild === generate). */
export function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

export function lexemeText(ix: ContentIndex, l: Lexeme): FaTextDto {
  return defined({
    fa: l.fa,
    translit: l.translit,
    faFormal: l.faFormal,
    faVocalized: l.faVocalized,
    audio: l.audio ? { normal: ix.view.mediaUrl(l.audio) } : undefined,
  })
}

export function sentenceAudio(ix: ContentView, s: CompiledSentence): FaTextDto['audio'] {
  if (!s.audio?.normal) return undefined
  return defined({
    normal: ix.mediaUrl(s.audio.normal),
    slow: s.audio.slow ? ix.mediaUrl(s.audio.slow) : undefined,
    envelope: s.audio.envelope ? ix.mediaUrl(s.audio.envelope) : undefined,
  })
}

export function sentenceText(ix: ContentIndex, s: CompiledSentence): FaTextDto {
  return defined({
    fa: s.fa,
    translit: s.translit,
    faFormal: s.faFormal,
    faVocalized: s.faVocalized,
    tokens: s.tokens,
    audio: sentenceAudio(ix.view, s),
  })
}

export function letterInfo(ix: ContentIndex, l: Letter): LetterInfo {
  return defined({
    id: l.id,
    letter: l.letter,
    name: l.name,
    translit: l.translit,
    ipa: l.ipa,
    connects: l.connects,
    forms: letterForms(l.letter),
    audio: l.audio ? ix.view.mediaUrl(l.audio) : undefined,
  })
}

// --------------------------------------------------------------------------------- answer keys
/** Escapes pattern syntax so a literal gloss or word compiles to exactly itself. */
export function literalPattern(text: string): string {
  return text.replace(/[\\[\]/]/g, (c) => `\\${c}`)
}

const lexemeGraphs = new WeakMap<Lexeme, { en: AnswerGraph; fa: AnswerGraph }>()

/** Answer graphs for a single word: English accepts any gloss; Persian accepts fa (and faFormal). */
export function lexemeGraph(l: Lexeme, lang: 'en' | 'fa'): AnswerGraph {
  let g = lexemeGraphs.get(l)
  if (!g) {
    g = {
      en: compile(l.glosses.map(literalPattern), { lang: 'en' }),
      fa: compile([literalPattern(l.fa)], {
        lang: 'fa',
        ...(l.faFormal ? { formal: literalPattern(l.faFormal) } : {}),
      }),
    }
    lexemeGraphs.set(l, g)
  }
  return g[lang]
}

/** Comparison key for a single word or tile (punctuation, case and ZWNJ insensitive). */
export function wordKey(text: string, lang: 'en' | 'fa'): string {
  return lang === 'fa' ? looseKey(text) : normalize(text).toLowerCase()
}

/** Every token that appears on any accepted path: a distractor tile must not be one of these. */
export function acceptedTokenKeys(graph: AnswerGraph, lang: 'en' | 'fa'): Set<string> {
  return new Set(graph.edges.filter((e) => e.t !== '').map((e) => wordKey(e.t, lang)))
}

/** The model answer of a graph as display text. */
export function modelAnswer(graph: AnswerGraph): string {
  return canonical(graph)
}

/** Splits a model answer into word tiles, stripping sentence punctuation. */
export function answerTiles(graph: AnswerGraph): string[] {
  return canonical(graph)
    .split(' ')
    .map((t) => t.replace(/^[.,!?;:،؛؟«»"]+|[.,!?;:،؛؟«»"]+$/g, ''))
    .filter(Boolean)
}

/** Lexeme ids a sentence uses (token order, deduplicated). */
export function sentenceLexemes(s: CompiledSentence): string[] {
  return [...new Set(s.tokens.flatMap((t) => (t.lexeme ? [t.lexeme] : [])))]
}

/** Splits a Persian word into letter tiles: combining marks and ZWNJ stay on their base letter. */
export function splitLetters(word: string): string[] {
  const out: string[] = []
  for (const ch of word.normalize('NFC')) {
    if (out.length > 0 && (/\p{M}/u.test(ch) || ch === '‌')) out[out.length - 1] += ch
    else if (ch.trim() !== '') out.push(ch)
  }
  return out
}

export type ItemKind = 'lexeme' | 'sentence' | 'chat' | 'letter'

/** The kind of a content id, from its prefix (lx_, s_, c_, l_). */
export function kindOfId(id: string): ItemKind | null {
  if (id.startsWith('lx_')) return 'lexeme'
  if (id.startsWith('s_')) return 'sentence'
  if (id.startsWith('c_')) return 'chat'
  if (id.startsWith('l_')) return 'letter'
  return null
}
