/**
 * @zaboon/session-engine: builds lesson sessions deterministically from content + learner state
 * (docs/LEARNING-ENGINE.md §5–§6).
 *
 * Wave 0 STUB: pinned challenges for select_translation, translate_bank, translate_type and
 * match_pairs; a trivial generated fallback. Owner: ws-engine, who implements every challenge
 * builder (13 MVP types), the new-word ladder, mix profiles, distractor rules, due-review mixing and
 * re-queue metadata. Keep the public API stable.
 */
import type {
  CharactersBundle,
  CompiledSentence,
  Lexeme,
  LettersBundle,
  Manifest,
  UnitBundle,
} from '@zaboon/content-schema'
import type { AppConfig, Challenge, ChallengeRef, FsrsCard, SessionKind } from '@zaboon/contracts'
import { canonical } from '@zaboon/grader'

export const IMPLEMENTATION: 'stub' | 'real' = 'stub'

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

export interface LearnerState {
  lexemeCards: Readonly<Record<string, FsrsCard>>
  letterCards: Readonly<Record<string, FsrsCard>>
  /** Item refs with open mistakes, most recent first. */
  mistakes: readonly string[]
  /** How many times each lexeme has been shown (transliteration fade, NEW WORD badges). */
  exposures: Readonly<Record<string, number>>
}

export interface GenerateInput {
  content: ContentView
  kind: SessionKind
  levelId: string | null
  /** 0-based lesson number within the level (difficulty ramps with it). */
  lessonIndex: number
  learner: LearnerState
  /** Deterministic seed (stored with the session). */
  seed: string
  now: Date
  config: AppConfig
}

export interface GeneratedSession {
  refs: ChallengeRef[]
  challenges: Challenge[]
}

export class NotImplementedError extends Error {}

/** Mulberry32 over a string hash: deterministic per seed. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function sentence(content: ContentView, id: string): CompiledSentence {
  const s = content.knownSentences.find((x) => x.id === id)
  if (!s) throw new Error(`unknown sentence ${id}`)
  return s
}

function lexeme(content: ContentView, id: string): Lexeme {
  const l = content.knownLexemes.find((x) => x.id === id)
  if (!l) throw new Error(`unknown lexeme ${id}`)
  return l
}

function faText(s: { fa: string; translit: string; faFormal?: string; faVocalized?: string }) {
  return { fa: s.fa, translit: s.translit, faFormal: s.faFormal, faVocalized: s.faVocalized }
}

/** Builds one runtime challenge from its compact ref. Deterministic for (ref, index, content). */
export function buildChallenge(ref: ChallengeRef, index: number, content: ContentView): Challenge {
  const rnd = seededRandom(`${index}:${ref.type}:${ref.items.join(',')}`)
  const common = { index, ref, isNew: false }
  switch (ref.type) {
    case 'select_translation': {
      const s = sentence(content, ref.items[0]!)
      const others = (ref.distractors ?? content.knownSentences.filter((x) => x.id !== s.id).slice(0, 2).map((x) => x.id)).map(
        (id) => sentence(content, id),
      )
      const options = shuffle([s, ...others], rnd)
      return {
        ...common,
        type: 'select_translation',
        direction: 'fa_en',
        prompt: { lang: 'fa', text: s.fa, fa: faText(s) },
        choices: options.map((o) => ({ lang: 'en' as const, text: canonical(o.graphs.en) })),
        answer: options.indexOf(s),
      }
    }
    case 'translate_bank':
    case 'translate_type': {
      const s = sentence(content, ref.items[0]!)
      const direction = ref.direction ?? 'fa_en'
      const answerLang = direction === 'fa_en' ? 'en' : 'fa'
      const graph = answerLang === 'en' ? s.graphs.en : s.graphs.fa
      const prompt =
        direction === 'fa_en'
          ? { lang: 'fa' as const, text: s.fa, fa: faText(s) }
          : { lang: 'en' as const, text: canonical(s.graphs.en) }
      if (ref.type === 'translate_type') return { ...common, type: 'translate_type', direction, prompt, answerLang, graph }
      const words = canonical(graph).split(' ')
      const pool =
        answerLang === 'fa'
          ? content.knownLexemes.map((l) => l.fa)
          : content.knownLexemes.flatMap((l) => l.glosses.slice(0, 1))
      const distractors = shuffle(pool.filter((w) => !words.includes(w)), rnd).slice(0, 3)
      return { ...common, type: 'translate_bank', direction, prompt, answerLang, graph, bank: shuffle([...words, ...distractors], rnd) }
    }
    case 'match_pairs': {
      const pairs = ref.items.slice(0, 5).map((id) => {
        const l = lexeme(content, id)
        return { fa: { fa: l.fa, translit: l.translit }, en: l.glosses[0]! }
      })
      return { ...common, type: 'match_pairs', pairs }
    }
    default:
      throw new NotImplementedError(`challenge builder not implemented yet: ${ref.type}`)
  }
}

/** Rebuilds a stored session's challenges from refs (server-side re-grading). */
export function rebuildChallenges(refs: readonly ChallengeRef[], content: ContentView): Challenge[] {
  return refs.map((r, i) => buildChallenge(r, i, content))
}

/** Generates a session. Stub: pinned challenges if the level has them, else translate_bank over focus sentences. */
export function generateSession(input: GenerateInput): GeneratedSession {
  const level = input.content.unit?.unit.levels.find((l) => l.id === input.levelId)
  const spec = level?.spec
  let refs: ChallengeRef[]
  if (spec && spec.pinned.length > 0) {
    refs = spec.pinned.map((p) => ({ type: p.type, items: p.items, direction: p.direction, distractors: p.distractors }))
  } else {
    const ids = spec?.focus.sentences.length ? spec.focus.sentences : input.content.knownSentences.map((s) => s.id)
    const rnd = seededRandom(input.seed)
    refs = shuffle(ids, rnd)
      .slice(0, input.config.session.lengths[input.kind] ?? 10)
      .map((id) => ({ type: 'translate_bank' as const, items: [id], direction: 'fa_en' as const }))
  }
  return { refs, challenges: rebuildChallenges(refs, input.content) }
}
