/**
 * Session planning (LEARNING-ENGINE §5): which refs a session contains, in which order.
 *
 *   1. Hand-pinned refs first (verbatim); `pinnedOnly` specs are exactly their pins.
 *   2. The new-word ladder for up to `newWordsPerLesson` unseen focus words (lessons only):
 *      NEW WORD intro (select_image when the word has a picture, else select_translation) →
 *      recognition (fa→en) → production (en→fa word bank) → listening (listen_tap).
 *   3. Review: open mistakes, then due FSRS cards (most overdue first), up to `reviewShare`.
 *   4. The rest follows the level's mix profile over the focus items.
 * Every candidate ref is probed with the real builder, so types whose media or distractors are
 * missing are skipped. All choices come from the seed: same input → same session.
 *
 * Wave 3 (P2) features, each off unless `GenerateInput.features` turns it on:
 * - `persianTyping`: the `typing` mix category (translate_type en→fa over sentences, listen_type,
 *   cloze_type) and ladder step 5 (typing the new word's translation, from the second lesson of a
 *   level on, like English typing);
 * - `letterTrace`: the `letterTrace` mix category (letter_trace) in letters sessions.
 * While a feature is off its category is dropped from the weights, its pool is never built and no
 * extra randomness is drawn, so the session is exactly the MVP's
 * (packages/session-engine/oracles/mvp-sessions.golden.json). A pinned P2 ref whose feature is off
 * is replaced in place by its MVP twin (`mvpTwin`). Stored refs hold what was built, so a rebuild
 * never depends on the flags.
 *
 * Practice hub (`practiceMode`, practice sessions only): `mixed` (or absent) is the MVP practice
 * session; `mistakes` starts with drills of the open mistakes, topped up to the session length by
 * the mixed plan; `listening` and `typing` keep to those challenge
 * kinds. A mode with nothing to offer falls back to `mixed`, byte-identical.
 */
import type {
  CompiledSentence,
  Letter,
  Lexeme,
  Level,
  LessonSpec,
  MixProfile,
} from '@zaboon/content-schema'
import { Challenge } from '@zaboon/contracts'
import type {
  AppConfig,
  ChallengeRef,
  ChallengeType,
  Direction,
  FsrsCard,
  PracticeMode,
  SessionKind,
} from '@zaboon/contracts'
import { isDue } from '@zaboon/srs'
import { buildChallenge } from './builders'
import { ContentError, indexContent, kindOfId, sentenceLexemes } from './content'
import type { ContentIndex, ContentView } from './content'
import { seededRandom, shuffle } from './random'
import { encodeVariant } from './variant'

export interface LearnerState {
  lexemeCards: Readonly<Record<string, FsrsCard>>
  letterCards: Readonly<Record<string, FsrsCard>>
  /** Item refs with open mistakes, most recent first. */
  mistakes: readonly string[]
  /** How many times each lexeme has been shown (transliteration fade, NEW WORD badges). */
  exposures: Readonly<Record<string, number>>
}

/** Wave 3 features a session may use; absent or false = off (the MVP session). */
export interface SessionFeatures {
  /** flags.persianKeyboard: typed Persian (translate_type en→fa, listen_type, cloze_type). */
  persianTyping?: boolean
  /** flags.letterTrace: letter_trace. */
  letterTrace?: boolean
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
  /** Wave 3 features from the request's flags (the server passes them; absent = all off). */
  features?: SessionFeatures
  /** Practice hub mode (P2, practice sessions only); absent = `mixed`. */
  practiceMode?: PracticeMode
}

export interface GeneratedSession {
  refs: ChallengeRef[]
  challenges: Challenge[]
}

type Rnd = () => number

/** Mix-profile categories (AppConfig.mixProfiles keys). */
type Category =
  | 'newWord'
  | 'recognition'
  | 'productionBank'
  | 'listening'
  | 'matching'
  | 'letterIntro'
  | 'letterSound'
  | 'letterForms'
  | 'readWord'
  | 'buildWord'
  | 'typing'
  | 'letterTrace'

const COURSE_FALLBACK: readonly Category[] = [
  'productionBank',
  'recognition',
  'listening',
  'matching',
]
const LETTER_FALLBACK: readonly Category[] = ['letterSound', 'readWord', 'buildWord', 'letterForms']
const DEFAULT_LENGTH = 12

const PROFILE_FOR_KIND: Readonly<Record<SessionKind, MixProfile | null>> = {
  lesson: null, // the level's spec.mix
  practice: 'practice',
  letters: 'letters',
  unit_review: 'standard',
  legendary: 'legendary',
  jump_test: 'legendary',
}

function refKey(r: ChallengeRef): string {
  return `${r.type}|${r.items.join(',')}|${r.direction ?? ''}|${r.variant ?? 0}`
}

function ref(
  type: ChallengeType,
  items: string[],
  extra: { direction?: Direction; option?: number; isNew?: boolean } = {},
): ChallengeRef {
  const variant = encodeVariant({ option: extra.option, isNew: extra.isNew })
  return {
    type,
    items,
    ...(extra.direction ? { direction: extra.direction } : {}),
    ...(variant === undefined ? {} : { variant }),
  }
}

/** Largest-remainder allocation of `total` slots over positive weights (ties: key order). */
export function allocate(
  weights: Readonly<Record<string, number>>,
  total: number,
): Map<string, number> {
  const entries = Object.entries(weights).filter(([, w]) => Number.isFinite(w) && w > 0)
  const sum = entries.reduce((n, [, w]) => n + w, 0)
  const out = new Map<string, number>()
  if (sum === 0 || total <= 0) return out
  const raw = entries.map(([k, w], i) => ({ k, i, exact: (w / sum) * total }))
  for (const r of raw) out.set(r.k, Math.floor(r.exact))
  let left = total - [...out.values()].reduce((n, v) => n + v, 0)
  for (const r of [...raw].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.i - b.i,
  )) {
    if (left-- <= 0) break
    out.set(r.k, out.get(r.k)! + 1)
  }
  return out
}

// ----------------------------------------------------------------------------------------- planner
class Planner {
  readonly ix: ContentIndex
  private readonly used = new Set<string>()
  private readonly probed = new Map<string, boolean>()

  constructor(readonly input: GenerateInput) {
    this.ix = indexContent(input.content)
  }

  /** True when `r` builds into a schema-valid challenge (cached). */
  ok(r: ChallengeRef): boolean {
    const k = refKey(r)
    let v = this.probed.get(k)
    if (v === undefined) {
      try {
        v = Challenge.safeParse(buildChallenge(r, 0, this.input.content)).success
      } catch (e) {
        if (!(e instanceof ContentError)) throw e
        v = false
      }
      this.probed.set(k, v)
    }
    return v
  }

  /** Claims the first unused, buildable ref of `candidates`. */
  take(candidates: readonly ChallengeRef[]): ChallengeRef | null {
    for (const r of candidates) {
      if (this.used.has(refKey(r)) || !this.ok(r)) continue
      this.used.add(refKey(r))
      return r
    }
    return null
  }

  claim(r: ChallengeRef): void {
    this.used.add(refKey(r))
  }

  release(r: ChallengeRef): void {
    this.used.delete(refKey(r))
  }

  /** Fills `total` slots following the mix weights; shortfalls go to the fallback order. */
  fillByMix(
    total: number,
    weights: Readonly<Record<string, number>>,
    pools: Partial<Record<Category, ChallengeRef[]>>,
    fallback: readonly Category[],
  ): ChallengeRef[] {
    const out: ChallengeRef[] = []
    let short = 0
    for (const [cat, n] of allocate(weights, total)) {
      const pool = pools[cat as Category] ?? []
      for (let i = 0; i < n; i++) {
        const r = this.take(pool)
        if (r) out.push(r)
        else short++
      }
    }
    for (let progress = true; short > 0 && progress;) {
      progress = false
      for (const cat of fallback) {
        if (short === 0) break
        const r = this.take(pools[cat] ?? [])
        if (r) {
          out.push(r)
          short--
          progress = true
        }
      }
    }
    return out
  }
}

function findLevel(content: ContentView, levelId: string | null): Level | null {
  if (levelId === null) return null
  return content.unit?.unit.levels.find((l) => l.id === levelId) ?? null
}

function mixWeights(cfg: AppConfig, profile: string): Record<string, number> {
  return cfg.mixProfiles[profile] ?? cfg.mixProfiles.standard ?? { productionBank: 1 }
}

/** Mix categories that exist only behind a Wave 3 feature (AppConfig.mixProfiles). */
const GATED_CATEGORIES: Readonly<Record<string, keyof SessionFeatures>> = {
  typing: 'persianTyping',
  letterTrace: 'letterTrace',
}

/**
 * The MVP twin of a P2 ref whose feature is off (the ref itself otherwise): typed Persian becomes
 * its word-bank or choice twin over the same item, a trace becomes the letter's forms. Used for
 * hand-pinned refs, so a pinned P2 level still plays with its flags off.
 */
export function mvpTwin(r: ChallengeRef, features: SessionFeatures | undefined): ChallengeRef {
  const typing = features?.persianTyping === true
  switch (r.type) {
    case 'translate_type':
      return !typing && r.direction === 'en_fa' ? { ...r, type: 'translate_bank' } : r
    case 'listen_type':
      return typing ? r : { ...r, type: 'listen_tap' }
    case 'cloze_type':
      return typing ? r : { ...r, type: 'cloze_choice' }
    case 'letter_trace':
      return features?.letterTrace === true ? r : { type: 'letter_forms', items: [r.items[0]!] }
    default:
      return r
  }
}

/** Drops every gated category whose feature is off (in place). */
function dropDisabled(
  weights: Record<string, number>,
  features: SessionFeatures | undefined,
): void {
  for (const [category, feature] of Object.entries(GATED_CATEGORIES))
    if (features?.[feature] !== true) delete weights[category]
}

// ----------------------------------------------------------------------------------- course pools
interface CoursePool {
  lexemes: Lexeme[]
  sentences: CompiledSentence[]
  chats: string[]
}

function existing<T>(ids: readonly string[], map: ReadonlyMap<string, T>): T[] {
  return [...new Set(ids)].flatMap((id) => {
    const v = map.get(id)
    return v === undefined ? [] : [v]
  })
}

function focusPool(ix: ContentIndex, specs: readonly LessonSpec[]): CoursePool {
  const unit = ix.view.unit
  let lexemes = existing(
    specs.flatMap((s) => s.focus.lexemes),
    ix.lexemes,
  )
  let sentences = existing(
    specs.flatMap((s) => s.focus.sentences),
    ix.sentences,
  )
  let chats = existing(
    specs.flatMap((s) => s.focus.chats),
    ix.chats,
  ).map((c) => c.id)
  if (unit && lexemes.length === 0)
    lexemes = ix.lexemeList.filter((l) => l.introducedIn === unit.unit.id)
  if (unit && sentences.length === 0)
    sentences = ix.sentenceList.filter((s) => s.unit === unit.unit.id)
  if (unit && chats.length === 0 && specs.length === 0) chats = unit.chats.map((c) => c.id)
  if (lexemes.length === 0) lexemes = [...ix.view.knownLexemes]
  if (sentences.length === 0) sentences = [...ix.view.knownSentences]
  return { lexemes, sentences, chats }
}

/** Practice: open mistakes, due cards, then the weakest learned words (by due date). */
function practicePool(p: Planner): CoursePool {
  const { ix } = p
  const { learner, now } = p.input
  const mistakes = learner.mistakes.map((r) => r.slice(r.indexOf(':') + 1))
  const carded = Object.entries(learner.lexemeCards)
    .filter(([id]) => ix.lexemes.has(id))
    .sort(
      ([a, ca], [b, cb]) =>
        Number(!isDue(ca, now)) - Number(!isDue(cb, now)) ||
        ca.due.localeCompare(cb.due) ||
        a.localeCompare(b),
    )
    .map(([id]) => id)
  let lexemes = existing(
    [...mistakes.filter((id) => kindOfId(id) === 'lexeme'), ...carded],
    ix.lexemes,
  )
  if (lexemes.length < 3)
    lexemes = [...lexemes, ...ix.view.knownLexemes.filter((l) => !lexemes.includes(l))]
  const wanted = new Set(lexemes.slice(0, 12).map((l) => l.id))
  const sentences = [
    ...existing(
      mistakes.filter((id) => kindOfId(id) === 'sentence'),
      ix.sentences,
    ),
    ...ix.sentenceList.filter((s) => sentenceLexemes(s).some((id) => wanted.has(id))),
  ]
  const chats = existing(
    mistakes.filter((id) => kindOfId(id) === 'chat'),
    ix.chats,
  ).map((c) => c.id)
  return { lexemes, sentences: [...new Set(sentences)], chats }
}

/** Sentences that use `lexemeId`: focus sentences first, then shortest. */
function sentencesWith(
  ix: ContentIndex,
  lexemeId: string,
  focus: readonly CompiledSentence[],
): CompiledSentence[] {
  const inFocus = new Set(focus.map((s) => s.id))
  return ix.sentenceList
    .filter((s) => sentenceLexemes(s).includes(lexemeId))
    .sort(
      (a, b) =>
        Number(!inFocus.has(a.id)) - Number(!inFocus.has(b.id)) ||
        a.tokens.length - b.tokens.length,
    )
}

/** The cloze option that blanks a sentence's first pool word (0 = the builder picks). */
function clozeTarget(p: Planner, pool: CoursePool, s: CompiledSentence): number {
  const lex = new Set(pool.lexemes.map((l) => l.id))
  const i = s.tokens.findIndex(
    (t) =>
      t.lexeme !== undefined && lex.has(t.lexeme) && p.ix.lexemes.get(t.lexeme)?.pos !== 'pronoun',
  )
  return i >= 0 ? i + 1 : 0
}

/** Typed Persian refs (P2) over sentences and words, interleaved by item. */
function persianTypingRefs(
  p: Planner,
  pool: CoursePool,
  sentences: readonly CompiledSentence[],
  lexemes: readonly Lexeme[],
): ChallengeRef[] {
  return [
    ...sentences.flatMap((s) => [
      ref('translate_type', [s.id], { direction: 'en_fa' }),
      ref('listen_type', [s.id]),
      ref('cloze_type', [s.id], { option: clozeTarget(p, pool, s) }),
    ]),
    ...lexemes.map((l) => ref('listen_type', [l.id])),
  ]
}

function coursePools(
  p: Planner,
  pool: CoursePool,
  allowTyping: boolean,
  rnd: Rnd,
): Partial<Record<Category, ChallengeRef[]>> {
  const S = shuffle(pool.sentences, rnd)
  const L = shuffle(pool.lexemes, rnd)
  const recognition = shuffle(
    [
      ...S.map((s) => ref('select_translation', [s.id], { direction: 'fa_en' })),
      ...S.map((s) => ref('cloze_choice', [s.id], { option: clozeTarget(p, pool, s) })),
      ...pool.chats.map((c) => ref('complete_chat', [c])),
      ...L.filter((l) => l.image).map((l) => ref('select_image', [l.id])),
    ],
    rnd,
  )
  recognition.push(...L.map((l) => ref('select_translation', [l.id], { direction: 'fa_en' })))
  const production = shuffle(
    [
      ...S.map((s) => ref('translate_bank', [s.id], { direction: 'en_fa' })),
      ...S.map((s) => ref('translate_bank', [s.id], { direction: 'fa_en' })),
      ...(allowTyping ? S.map((s) => ref('translate_type', [s.id], { direction: 'fa_en' })) : []),
    ],
    rnd,
  )
  production.push(...L.map((l) => ref('translate_bank', [l.id], { direction: 'en_fa' })))
  const listening = [
    ...S.map((s) => ref('listen_tap', [s.id])),
    ...L.map((l) => ref('listen_tap', [l.id])),
  ]
  const matching: ChallengeRef[] = []
  for (let start = 0; start + 3 <= L.length; start += 5) {
    const group: Lexeme[] = []
    const glosses = new Set<string>()
    for (const l of L.slice(start)) {
      if (group.length === 5) break
      const g = l.glosses[0]!.toLowerCase()
      if (!glosses.has(g)) {
        glosses.add(g)
        group.push(l)
      }
    }
    if (group.length >= 3)
      matching.push(
        ref(
          'match_pairs',
          group.map((l) => l.id),
        ),
      )
  }
  const pools: Partial<Record<Category, ChallengeRef[]>> = {
    recognition,
    productionBank: production,
    listening,
    matching,
  }
  // P2 pools come last and draw from `rnd` only while their feature is on (MVP sessions unchanged).
  if (allowTyping && p.input.features?.persianTyping === true)
    pools.typing = shuffle(persianTypingRefs(p, pool, S, L), rnd)
  return pools
}

/** Round-robin over lists: the first of each, then the second of each, … */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]!)
  return out
}

/**
 * A practice-hub session other than `mixed` (empty when the mode has nothing to offer, or for
 * `mixed`/no mode; the caller then plans today's practice session). Items keep the practice
 * pool's priority (open mistakes, due cards, weakest words); no randomness is drawn here.
 */
function planPracticeMode(p: Planner, pool: CoursePool, budget: number): ChallengeRef[] {
  const { practiceMode, features, learner } = p.input
  const typing = features?.persianTyping === true
  const takeAll = (candidates: readonly ChallengeRef[]) => {
    const out: ChallengeRef[] = []
    for (const r of candidates) {
      if (out.length >= budget) break
      if (p.take([r])) out.push(r)
    }
    return out
  }
  const S = pool.sentences
  const L = pool.lexemes
  switch (practiceMode) {
    case 'mistakes': {
      // Open mistakes only, each drilled through its review exercises in turn.
      const items = [...new Set(learner.mistakes.map((r) => r.slice(r.indexOf(':') + 1)))]
      const out: ChallengeRef[] = []
      let turn = 0
      for (let progress = true; progress && out.length < budget;) {
        progress = false
        for (const item of items) {
          if (out.length >= budget) break
          const r = reviewRef(p, item, turn++, S)
          if (r) {
            out.push(r)
            progress = true
          }
        }
      }
      return out
    }
    case 'listening':
      return takeAll(
        interleave([
          S.map((s) => ref('listen_tap', [s.id])),
          L.map((l) => ref('listen_tap', [l.id])),
          typing ? S.map((s) => ref('listen_type', [s.id])) : [],
          typing ? L.map((l) => ref('listen_type', [l.id])) : [],
        ]),
      )
    case 'typing':
      return takeAll(
        interleave([
          S.map((s) => ref('translate_type', [s.id], { direction: 'fa_en' })),
          L.map((l) => ref('translate_type', [l.id], { direction: 'fa_en' })),
          typing ? S.map((s) => ref('translate_type', [s.id], { direction: 'en_fa' })) : [],
          typing ? S.map((s) => ref('listen_type', [s.id])) : [],
          typing
            ? S.map((s) => ref('cloze_type', [s.id], { option: clozeTarget(p, pool, s) }))
            : [],
          typing ? L.map((l) => ref('translate_type', [l.id], { direction: 'en_fa' })) : [],
        ]),
      )
    default:
      return []
  }
}

/** One review ref for an item, rotating through recognition / production / listening. */
function reviewRef(
  p: Planner,
  item: string,
  turn: number,
  focus: readonly CompiledSentence[],
): ChallengeRef | null {
  const kind = kindOfId(item)
  if (kind === 'chat') return p.ix.chats.has(item) ? p.take([ref('complete_chat', [item])]) : null
  if (kind === 'sentence') {
    if (!p.ix.sentences.has(item)) return null
    const options = [
      ref('translate_bank', [item], { direction: 'fa_en' }),
      ref('select_translation', [item], { direction: 'fa_en' }),
      ref('listen_tap', [item]),
      ref('translate_bank', [item], { direction: 'en_fa' }),
    ]
    return p.take([...options.slice(turn % 3), ...options.slice(0, turn % 3)])
  }
  if (kind !== 'lexeme' || !p.ix.lexemes.has(item)) return null
  const withWord = sentencesWith(p.ix, item, focus)
  const production = [
    ...withWord.map((s) => ref('translate_bank', [s.id], { direction: 'en_fa' })),
    ref('translate_bank', [item], { direction: 'en_fa' }),
  ]
  const recognition = [
    ref('select_translation', [item], { direction: 'fa_en' }),
    ...withWord.map((s) => ref('select_translation', [s.id], { direction: 'fa_en' })),
  ]
  const listening = [...withWord.map((s) => ref('listen_tap', [s.id])), ref('listen_tap', [item])]
  const order = [production, recognition, listening]
  return p.take([...order.slice(turn % 3), ...order.slice(0, turn % 3)].flat())
}

function planCourse(
  p: Planner,
  level: Level | null,
  budget: number,
  rnd: Rnd,
): { front: ChallengeRef[]; rest: ChallengeRef[] } {
  const { input, ix } = p
  const { kind, config, learner, now } = input
  let pool: CoursePool
  if (kind === 'practice') pool = practicePool(p)
  else if (
    kind === 'unit_review' ||
    kind === 'jump_test' ||
    (level === null && ix.view.unit !== null)
  ) {
    pool = focusPool(
      ix,
      (ix.view.unit?.unit.levels ?? []).flatMap((l) => (l.spec ? [l.spec] : [])),
    )
  } else pool = focusPool(ix, level?.spec ? [level.spec] : [])
  // Practice hub: `listening` and `typing` replace the session; a `mistakes` drill comes first and
  // the mixed practice plan tops it up to the session length (a one-mistake drill is never a
  // one-challenge session with a full session's rewards).
  let drill: ChallengeRef[] = []
  if (kind === 'practice') {
    drill = planPracticeMode(p, pool, budget)
    if (drill.length > 0 && input.practiceMode !== 'mistakes') return { front: [], rest: drill }
  }

  const profile = PROFILE_FOR_KIND[kind] ?? level?.spec?.mix ?? 'standard'
  const weights = { ...mixWeights(config, profile) }
  dropDisabled(weights, input.features)
  // Typing (English, and Persian with the feature) starts with a level's second lesson.
  const allowTyping = kind !== 'lesson' || input.lessonIndex >= 1
  const persianTyping = allowTyping && input.features?.persianTyping === true
  if (!allowTyping) delete weights.typing
  const front: ChallengeRef[] = [...drill]
  const rest: ChallengeRef[] = []
  let left = budget - drill.length

  // --- review candidates: open mistakes, then due cards (most overdue first) --------------------
  const reviewSlots = kind === 'practice' ? budget : Math.floor(budget * config.session.reviewShare)
  const fresh =
    kind === 'lesson'
      ? pool.lexemes
          .filter((l) => learner.lexemeCards[l.id] === undefined)
          .slice(0, config.session.newWordsPerLesson)
      : []
  const freshIds = new Set(fresh.map((l) => l.id))
  const dueIds = Object.entries(learner.lexemeCards)
    .filter(([id, c]) => isDue(c, now) && ix.lexemes.has(id))
    .sort(([a, ca], [b, cb]) => ca.due.localeCompare(cb.due) || a.localeCompare(b))
    .map(([id]) => id)
  const reviewItems = [
    ...new Set([...learner.mistakes.map((r) => r.slice(r.indexOf(':') + 1)), ...dueIds]),
  ].filter((id) => !freshIds.has(id))
  const reserve = Math.min(reviewSlots, reviewItems.length)

  // --- new-word ladder (lessons only): a word is introduced only if its whole ladder fits ------
  for (const w of fresh) {
    const withWord = sentencesWith(ix, w.id, pool.sentences)
    const intro = p.take([
      ...(w.image ? [ref('select_image', [w.id], { isNew: true })] : []),
      ref('select_translation', [w.id], { direction: 'fa_en', isNew: true }),
    ])
    if (!intro) continue
    const steps = [
      intro,
      p.take([
        ...withWord.map((s) => ref('select_translation', [s.id], { direction: 'fa_en' })),
        ref('select_translation', [w.id], { direction: 'en_fa' }),
      ]),
      p.take([
        ...withWord.map((s) => ref('translate_bank', [s.id], { direction: 'en_fa' })),
        ref('translate_bank', [w.id], { direction: 'en_fa' }),
      ]),
      p.take([...withWord.map((s) => ref('listen_tap', [s.id])), ref('listen_tap', [w.id])]),
      // Step 5 (P2): type the translation in Persian.
      persianTyping
        ? p.take([
            ...withWord.map((s) => ref('translate_type', [s.id], { direction: 'en_fa' })),
            ref('translate_type', [w.id], { direction: 'en_fa' }),
          ])
        : null,
    ].filter((r): r is ChallengeRef => r !== null)
    const room = left - reserve
    const kept =
      front.length === 0 ? steps.slice(0, Math.max(1, room)) : steps.length <= room ? steps : []
    steps.slice(kept.length).forEach((r) => p.release(r))
    if (kept.length === 0) break
    front.push(...kept.slice(0, 2))
    rest.push(...kept.slice(2))
    left -= kept.length
  }
  delete weights.newWord

  // --- review ---------------------------------------------------------------------------------
  let turn = Math.floor(rnd() * 3)
  let reviewed = 0
  for (const item of reviewItems) {
    if (reviewed >= reviewSlots || left <= 0) break
    const r = reviewRef(p, item, turn++, pool.sentences)
    if (r) {
      rest.push(r)
      left--
      reviewed++
    }
  }

  // --- the rest by mix profile ----------------------------------------------------------------
  rest.push(
    ...p.fillByMix(
      Math.max(0, left),
      weights,
      coursePools(p, pool, allowTyping, rnd),
      COURSE_FALLBACK,
    ),
  )
  return { front, rest }
}

// ---------------------------------------------------------------------------------- letters plan
function lettersFor(p: Planner, level: Level | null): Letter[] {
  const { ix, input } = p
  if (level?.spec && level.spec.focus.letters.length > 0)
    return existing(level.spec.focus.letters, ix.letters)
  const lessons = ix.view.letters.track.lessons
  const lesson =
    lessons.find((l) => l.id === input.levelId) ??
    lessons.find((l) => l.letters.some((id) => input.learner.letterCards[id] === undefined)) ??
    null
  if (lesson) return existing(lesson.letters, ix.letters)
  // Everything introduced: practise the weakest (earliest due) letters.
  return Object.entries(input.learner.letterCards)
    .filter(([id]) => ix.letters.has(id))
    .sort(([a, ca], [b, cb]) => ca.due.localeCompare(cb.due) || a.localeCompare(b))
    .slice(0, 5)
    .map(([id]) => ix.letter(id))
}

function planLetters(
  p: Planner,
  level: Level | null,
  budget: number,
  rnd: Rnd,
): { front: ChallengeRef[]; rest: ChallengeRef[] } {
  const { ix, input } = p
  const { learner, config, now } = input
  const letters = lettersFor(p, level)
  if (letters.length === 0) throw new ContentError('letters session: no letters to teach')
  const front: ChallengeRef[] = []
  const rest: ChallengeRef[] = []
  let left = budget

  // New letters: at most newWordsPerLesson per session, each met (intro) then heard (sound).
  const fresh = letters
    .filter((x) => learner.letterCards[x.id] === undefined)
    .slice(0, config.session.newWordsPerLesson)
  for (const l of fresh) {
    if (left < 2) break
    const intro = p.take([ref('letter_intro', [l.id], { isNew: true })])
    const sound = p.take([ref('letter_sound', [l.id], { option: 0 })])
    for (const r of [intro, sound]) {
      if (!r) continue
      front.push(r)
      left--
    }
  }

  const reviewSlots = Math.floor(budget * config.session.reviewShare)
  const inLesson = new Set(letters.map((l) => l.id))
  const due = Object.entries(learner.letterCards)
    .filter(([id, c]) => !inLesson.has(id) && ix.letters.has(id) && isDue(c, now))
    .sort(([a, ca], [b, cb]) => ca.due.localeCompare(cb.due) || a.localeCompare(b))
  for (const [id] of due.slice(0, Math.min(reviewSlots, left))) {
    const r = p.take(
      shuffle(
        [ref('letter_sound', [id], { option: 0 }), ref('letter_sound', [id], { option: 1 })],
        rnd,
      ),
    )
    if (!r) continue
    rest.push(r)
    left--
  }

  const L = shuffle(letters, rnd)
  const examples = [...new Set(letters.flatMap((l) => l.examples))].filter((id) =>
    ix.lexemes.has(id),
  )
  const E = shuffle(examples, rnd)
  const groups: ChallengeRef[] = []
  for (let i = 0; i + 2 <= L.length; i += 3)
    groups.push(
      ref(
        'letter_forms',
        L.slice(i, i + 3).map((l) => l.id),
      ),
    )
  if (L.length >= 2 && L.length % 3 === 1)
    groups.push(ref('letter_forms', [L.at(-1)!.id, L[0]!.id]))
  const pools: Partial<Record<Category, ChallengeRef[]>> = {
    letterSound: shuffle(
      L.flatMap((l) => [
        ref('letter_sound', [l.id], { option: 0 }),
        ref('letter_sound', [l.id], { option: 1 }),
      ]),
      rnd,
    ),
    letterForms: [...groups, ...L.map((l) => ref('letter_forms', [l.id]))],
    readWord: shuffle(
      E.flatMap((id) => [
        ref('read_word', [id], { option: 0 }),
        ref('read_word', [id], { option: 1 }),
      ]),
      rnd,
    ),
    buildWord: E.map((id) => ref('build_word', [id])),
  }
  // P2: trace each letter isolated and in one joined form (a non-connector: its final form).
  if (input.features?.letterTrace === true)
    pools.letterTrace = shuffle(
      L.flatMap((l) => [
        ref('letter_trace', [l.id]),
        ref('letter_trace', [l.id], { option: l.connects ? 1 + Math.floor(rnd() * 3) : 3 }),
      ]),
      rnd,
    )
  // The letterIntro share is served by the new-letter intros above (like newWord in lessons).
  const weights = { ...mixWeights(config, 'letters') }
  delete weights.letterIntro
  dropDisabled(weights, input.features)
  rest.push(...p.fillByMix(Math.max(0, left), weights, pools, LETTER_FALLBACK))
  return { front, rest }
}

// ------------------------------------------------------------------------------------- generate
/** Generates a session: refs (stored) and the challenges they build (sent to the player). */
export function generateSession(input: GenerateInput): GeneratedSession {
  const p = new Planner(input)
  const level = findLevel(input.content, input.levelId)
  const spec = level?.spec
  const pinned: ChallengeRef[] = (spec?.pinned ?? []).map((x) =>
    mvpTwin(
      {
        type: x.type,
        items: [...x.items],
        ...(x.direction ? { direction: x.direction } : {}),
        ...(x.distractors ? { distractors: [...x.distractors] } : {}),
      },
      input.features,
    ),
  )
  let refs: ChallengeRef[]
  if (spec?.pinnedOnly && pinned.length > 0) refs = pinned
  else {
    pinned.forEach((r) => p.claim(r))
    const length = spec?.length ?? input.config.session.lengths[input.kind] ?? DEFAULT_LENGTH
    const budget = Math.max(0, length - pinned.length)
    const rnd = seededRandom(
      `${input.seed}|${input.kind}|${input.levelId ?? ''}|${input.lessonIndex}`,
    )
    const letters = input.kind === 'letters' || spec?.mix === 'letters'
    const { front, rest } = letters
      ? planLetters(p, level, budget, rnd)
      : planCourse(p, level, budget, rnd)
    refs = [...pinned, ...front, ...shuffle(rest, rnd)]
  }
  if (refs.length === 0)
    throw new ContentError(`no challenges for ${input.kind} ${input.levelId ?? ''}`)
  const challenges = refs.map((r, i) => buildChallenge(r, i, input.content))
  return { refs, challenges }
}
