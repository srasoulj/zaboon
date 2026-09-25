/**
 * Challenge builders: one compact ChallengeRef → one runtime Challenge (LEARNING-ENGINE §6).
 * A build depends only on (ref, index, content), so a stored session rebuilds exactly.
 *
 * Builders throw ContentError when a ref cannot be built (missing media, too few distractors);
 * those conditions never depend on the random stream, so the planner can probe refs up front.
 *
 * Distractor rules (§5): same part of speech and similar length preferred, drawn from content
 * up to the current unit; a distractor that is an accepted variant of the answer is rejected
 * (checked with the grader's `accepts`).
 */
import type { CompiledSentence, Letter, Lexeme } from '@zaboon/content-schema'
import type {
  AnswerGraph,
  Challenge,
  ChallengeOf,
  ChallengeRef,
  Direction,
} from '@zaboon/contracts'
import { accepts } from '@zaboon/grader'
import {
  ContentError,
  acceptedTokenKeys,
  answerTiles,
  indexContent,
  kindOfId,
  letterInfo,
  lexemeGraph,
  lexemeText,
  modelAnswer,
  sentenceAudio,
  sentenceLexemes,
  sentenceText,
  splitLetters,
  wordKey,
} from './content'
import type { ContentIndex, ContentView } from './content'
import { pickBest, seededRandom, shuffle } from './random'
import { decodeVariant } from './variant'

type Rnd = () => number
type Lang = 'en' | 'fa'
type PromptText = ChallengeOf<'select_translation'>['prompt']

/** Choices per multiple-choice challenge (answer included). */
const CHOICES = 4
const CLOZE_CHOICES = 3
const BANK_DISTRACTORS = 3
const BUILD_WORD_DISTRACTORS = 2
const MAX_PAIRS = 5

// --------------------------------------------------------------------------------------- helpers
function lengthScore(a: string, b: string): number {
  return Math.min(9, Math.abs([...a].length - [...b].length))
}

/** Takes up to `count` items from `sorted` whose `key` is new (and not in `taken`). */
function distinctBy<T>(
  sorted: readonly T[],
  count: number,
  key: (t: T) => string,
  taken: Iterable<string> = [],
): T[] {
  const seen = new Set(taken)
  const out: T[] = []
  for (const t of sorted) {
    if (out.length >= count) break
    const k = key(t)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/** Places `answer` among `others` in a seeded order; returns the choices and the answer index. */
function withAnswer<T>(
  answer: T,
  others: readonly T[],
  rnd: Rnd,
): { choices: T[]; answer: number } {
  const all = shuffle([answer, ...others], rnd)
  return { choices: all, answer: all.indexOf(answer) }
}

function requireChoices(n: number, what: string): void {
  if (n < 1) throw new ContentError(`${what}: no valid distractor`)
}

const gloss = (l: Lexeme) => l.glosses[0]!

/**
 * Other lexemes as distractors for `target`: never the same word, never a value the target's
 * answer key accepts; same part of speech, then similar length first.
 */
function lexemeDistractors(
  ix: ContentIndex,
  target: Lexeme,
  count: number,
  rnd: Rnd,
  opts: {
    value: (l: Lexeme) => string
    lang: Lang
    where?: (l: Lexeme) => boolean
    pinned?: readonly string[]
  },
): Lexeme[] {
  const targetKey = wordKey(opts.value(target), opts.lang)
  const graph = lexemeGraph(target, opts.lang)
  const ok = (l: Lexeme) =>
    l.id !== target.id &&
    wordKey(l.fa, 'fa') !== wordKey(target.fa, 'fa') &&
    wordKey(opts.value(l), opts.lang) !== targetKey &&
    !accepts(graph, opts.value(l), opts.lang) &&
    (opts.where?.(l) ?? true)
  const key = (l: Lexeme) => wordKey(opts.value(l), opts.lang)
  if (opts.pinned)
    return distinctBy(opts.pinned.map((id) => ix.lexeme(id)).filter(ok), count, key, [targetKey])
  const sorted = pickBest(
    ix.lexemeList.filter(ok),
    Number.MAX_SAFE_INTEGER,
    (l) => (l.pos === target.pos ? 0 : 10) + lengthScore(opts.value(l), opts.value(target)),
    rnd,
  )
  return distinctBy(sorted, count, key, [targetKey])
}

function sentenceGraph(s: CompiledSentence, lang: Lang): AnswerGraph {
  return lang === 'en' ? s.graphs.en : s.graphs.fa
}

/** A sentence's display text in `lang`: the Persian as written, or the English model answer. */
function sentenceDisplay(s: CompiledSentence, lang: Lang): string {
  return lang === 'fa' ? s.fa : modelAnswer(s.graphs.en)
}

/** Two sentences are interchangeable answers if either key accepts the other's model answer. */
function sameMeaning(a: CompiledSentence, b: CompiledSentence, lang: Lang): boolean {
  const ga = sentenceGraph(a, lang)
  const gb = sentenceGraph(b, lang)
  return accepts(ga, modelAnswer(gb), lang) || accepts(gb, modelAnswer(ga), lang)
}

function sentenceDistractors(
  ix: ContentIndex,
  target: CompiledSentence,
  count: number,
  lang: Lang,
  rnd: Rnd,
  pinned?: readonly string[],
): CompiledSentence[] {
  const targetKey = wordKey(sentenceDisplay(target, lang), lang)
  const ok = (s: CompiledSentence) =>
    s.id !== target.id &&
    wordKey(sentenceDisplay(s, lang), lang) !== targetKey &&
    !sameMeaning(target, s, lang)
  const key = (s: CompiledSentence) => wordKey(sentenceDisplay(s, lang), lang)
  if (pinned)
    return distinctBy(pinned.map((id) => ix.sentence(id)).filter(ok), count, key, [targetKey])
  const shared = new Set(sentenceLexemes(target))
  const sorted = pickBest(
    ix.sentenceList.filter(ok),
    Number.MAX_SAFE_INTEGER,
    (s) =>
      Math.min(9, Math.abs(s.tokens.length - target.tokens.length)) * 2 +
      (sentenceLexemes(s).some((id) => shared.has(id)) ? 0 : 1),
    rnd,
  )
  return distinctBy(sorted, count, key, [targetKey])
}

/**
 * Word-bank distractor tiles: single words from other lexemes (Persian surface or English gloss
 * words) that appear on no accepted path of `graph`. Same part of speech as the answer's words and
 * similar length first.
 */
function bankDistractors(
  ix: ContentIndex,
  graph: AnswerGraph,
  lang: Lang,
  answer: readonly string[],
  answerPos: ReadonlySet<string>,
  count: number,
  rnd: Rnd,
): string[] {
  const banned = acceptedTokenKeys(graph, lang)
  for (const w of answer) banned.add(wordKey(w, lang))
  const pool: { word: string; pos: string }[] = []
  for (const l of ix.lexemeList) {
    if (lang === 'fa') {
      if (!/\s/.test(l.fa)) pool.push({ word: l.fa, pos: l.pos })
    } else {
      for (const g of l.glosses) if (!/\s/.test(g)) pool.push({ word: g, pos: l.pos })
    }
  }
  const candidates = pool.filter((p) => !banned.has(wordKey(p.word, lang)))
  const avg =
    answer.length === 0 ? 3 : answer.reduce((n, w) => n + [...w].length, 0) / answer.length
  const sorted = pickBest(
    candidates,
    Number.MAX_SAFE_INTEGER,
    (p) =>
      (answerPos.has(p.pos) ? 0 : 10) + Math.min(9, Math.round(Math.abs([...p.word].length - avg))),
    rnd,
  )
  return distinctBy(sorted, count, (p) => wordKey(p.word, lang)).map((p) => p.word)
}

function posOfSentence(ix: ContentIndex, s: CompiledSentence): Set<string> {
  return new Set(
    sentenceLexemes(s).flatMap((id) => (ix.lexemes.has(id) ? [ix.lexeme(id).pos] : [])),
  )
}

// ---------------------------------------------------------------------------------- word items
/** A lexeme or a sentence behind one ref item. */
type Item = { kind: 'lexeme'; lexeme: Lexeme } | { kind: 'sentence'; sentence: CompiledSentence }

function wordItem(ix: ContentIndex, id: string): Item {
  const kind = kindOfId(id)
  if (kind === 'lexeme') return { kind, lexeme: ix.lexeme(id) }
  if (kind === 'sentence') return { kind, sentence: ix.sentence(id) }
  throw new ContentError(`expected a lexeme or sentence id, got ${id}`)
}

function itemGraph(item: Item, lang: Lang): AnswerGraph {
  return item.kind === 'lexeme'
    ? lexemeGraph(item.lexeme, lang)
    : sentenceGraph(item.sentence, lang)
}

function itemPrompt(ix: ContentIndex, item: Item, lang: Lang): PromptText {
  if (lang === 'en')
    return {
      lang: 'en',
      text: item.kind === 'lexeme' ? gloss(item.lexeme) : modelAnswer(item.sentence.graphs.en),
    }
  return item.kind === 'lexeme'
    ? { lang: 'fa', text: item.lexeme.fa, fa: lexemeText(ix, item.lexeme) }
    : { lang: 'fa', text: item.sentence.fa, fa: sentenceText(ix, item.sentence) }
}

/** Word tiles of the model answer; Persian sentences use their token surfaces when accepted. */
function itemTiles(item: Item, lang: Lang): string[] {
  const graph = itemGraph(item, lang)
  if (lang === 'fa' && item.kind === 'sentence') {
    const surfaces = item.sentence.tokens.map((t) => t.surface)
    if (accepts(graph, surfaces, 'fa')) return surfaces
  }
  const tiles = answerTiles(graph)
  return accepts(graph, tiles, lang) ? tiles : modelAnswer(graph).split(' ')
}

function itemPos(ix: ContentIndex, item: Item): Set<string> {
  return item.kind === 'lexeme' ? new Set([item.lexeme.pos]) : posOfSentence(ix, item.sentence)
}

// ------------------------------------------------------------------------------------- builders
interface Ctx {
  ix: ContentIndex
  ref: ChallengeRef
  rnd: Rnd
  common: { index: number; ref: ChallengeRef; isNew: boolean }
  option: number
}

function selectImage(c: Ctx): ChallengeOf<'select_image'> {
  const target = c.ix.lexeme(c.ref.items[0]!)
  if (!target.image) throw new ContentError(`select_image: ${target.id} has no image`)
  const others = lexemeDistractors(c.ix, target, CHOICES - 1, c.rnd, {
    value: gloss,
    lang: 'en',
    where: (l) => l.image !== undefined,
    pinned: c.ref.distractors,
  })
  requireChoices(others.length, `select_image ${target.id}`)
  const toChoice = (l: Lexeme) => ({
    lexeme: l.id,
    image: c.ix.view.mediaUrl(l.image!),
    label: gloss(l),
  })
  const { choices, answer } = withAnswer(target, others, c.rnd)
  return {
    ...c.common,
    type: 'select_image',
    prompt: lexemeText(c.ix, target),
    choices: choices.map(toChoice),
    answer,
  }
}

function selectTranslation(c: Ctx): ChallengeOf<'select_translation'> {
  const direction: Direction = c.ref.direction ?? 'fa_en'
  const promptLang: Lang = direction === 'fa_en' ? 'fa' : 'en'
  const answerLang: Lang = direction === 'fa_en' ? 'en' : 'fa'
  const item = wordItem(c.ix, c.ref.items[0]!)
  let options: Item[]
  if (item.kind === 'lexeme') {
    const value = answerLang === 'en' ? gloss : (l: Lexeme) => l.fa
    options = lexemeDistractors(c.ix, item.lexeme, CHOICES - 1, c.rnd, {
      value,
      lang: answerLang,
      pinned: c.ref.distractors,
    }).map((lexeme) => ({ kind: 'lexeme', lexeme }))
  } else {
    options = sentenceDistractors(
      c.ix,
      item.sentence,
      CHOICES - 1,
      answerLang,
      c.rnd,
      c.ref.distractors,
    ).map((sentence) => ({
      kind: 'sentence',
      sentence,
    }))
  }
  requireChoices(options.length, `select_translation ${c.ref.items[0]}`)
  const { choices, answer } = withAnswer(item, options, c.rnd)
  return {
    ...c.common,
    type: 'select_translation',
    direction,
    prompt: itemPrompt(c.ix, item, promptLang),
    choices: choices.map((o) => itemPrompt(c.ix, o, answerLang)),
    answer,
  }
}

function translate(c: Ctx): ChallengeOf<'translate_bank'> | ChallengeOf<'translate_type'> {
  const direction: Direction = c.ref.direction ?? 'fa_en'
  const answerLang: Lang = direction === 'fa_en' ? 'en' : 'fa'
  const item = wordItem(c.ix, c.ref.items[0]!)
  const prompt = itemPrompt(c.ix, item, direction === 'fa_en' ? 'fa' : 'en')
  const graph = itemGraph(item, answerLang)
  if (c.ref.type === 'translate_type')
    return { ...c.common, type: 'translate_type', direction, prompt, answerLang, graph }
  const words = itemTiles(item, answerLang)
  const extra = bankDistractors(
    c.ix,
    graph,
    answerLang,
    words,
    itemPos(c.ix, item),
    BANK_DISTRACTORS,
    c.rnd,
  )
  if (words.length + extra.length < 2)
    throw new ContentError(`translate_bank ${c.ref.items[0]}: bank too small`)
  return {
    ...c.common,
    type: 'translate_bank',
    direction,
    prompt,
    answerLang,
    graph,
    bank: shuffle([...words, ...extra], c.rnd),
  }
}

function matchPairs(c: Ctx): ChallengeOf<'match_pairs'> {
  const lexemes = c.ref.items.slice(0, MAX_PAIRS).map((id) => c.ix.lexeme(id))
  const en = new Set(lexemes.map((l) => wordKey(gloss(l), 'en')))
  const fa = new Set(lexemes.map((l) => wordKey(l.fa, 'fa')))
  if (lexemes.length < 3 || en.size < lexemes.length || fa.size < lexemes.length) {
    throw new ContentError(`match_pairs needs 3–5 distinct words: ${c.ref.items.join(',')}`)
  }
  return {
    ...c.common,
    type: 'match_pairs',
    pairs: lexemes.map((l) => ({ fa: lexemeText(c.ix, l), en: gloss(l) })),
  }
}

function listenTap(c: Ctx): ChallengeOf<'listen_tap'> {
  const item = wordItem(c.ix, c.ref.items[0]!)
  const audio =
    item.kind === 'sentence'
      ? sentenceAudio(c.ix.view, item.sentence)
      : item.lexeme.audio
        ? { normal: c.ix.view.mediaUrl(item.lexeme.audio) }
        : undefined
  if (!audio?.normal) throw new ContentError(`listen_tap ${c.ref.items[0]}: no audio`)
  const graph = itemGraph(item, 'fa')
  const words = itemTiles(item, 'fa')
  const extra = bankDistractors(
    c.ix,
    graph,
    'fa',
    words,
    itemPos(c.ix, item),
    BANK_DISTRACTORS,
    c.rnd,
  )
  if (words.length + extra.length < 2)
    throw new ContentError(`listen_tap ${c.ref.items[0]}: bank too small`)
  const transcript =
    item.kind === 'sentence' ? sentenceText(c.ix, item.sentence) : lexemeText(c.ix, item.lexeme)
  return {
    ...c.common,
    type: 'listen_tap',
    audio,
    transcript,
    bank: shuffle([...words, ...extra], c.rnd),
    graph,
  }
}

/** Tokens that can be blanked: they name a known lexeme; pronouns only as a last resort. */
function clozeCandidates(ix: ContentIndex, s: CompiledSentence): number[] {
  const withLexeme = s.tokens.flatMap((t, i) => (t.lexeme && ix.lexemes.has(t.lexeme) ? [i] : []))
  const content = withLexeme.filter((i) => ix.lexeme(s.tokens[i]!.lexeme!).pos !== 'pronoun')
  return content.length > 0 ? content : withLexeme
}

function clozeChoice(c: Ctx): ChallengeOf<'cloze_choice'> {
  const s = c.ix.sentence(c.ref.items[0]!)
  const candidates = clozeCandidates(c.ix, s)
  const blank = c.option > 0 ? c.option - 1 : candidates[Math.floor(c.rnd() * candidates.length)]
  if (blank === undefined || !candidates.includes(blank))
    throw new ContentError(`cloze_choice ${s.id}: nothing to blank`)
  const token = s.tokens[blank]!
  const target = c.ix.lexeme(token.lexeme!)
  const surfaces = s.tokens.map((t) => t.surface)
  const fills = (word: string) =>
    accepts(
      s.graphs.fa,
      surfaces.map((w, i) => (i === blank ? word : w)),
      'fa',
    )
  const others = lexemeDistractors(c.ix, target, CLOZE_CHOICES - 1, c.rnd, {
    value: (l) => l.fa,
    lang: 'fa',
    where: (l) =>
      !/\s/.test(l.fa) && wordKey(l.fa, 'fa') !== wordKey(token.surface, 'fa') && !fills(l.fa),
    pinned: c.ref.distractors,
  }).map((l) => l.fa)
  requireChoices(others.length, `cloze_choice ${s.id}`)
  const { choices, answer } = withAnswer(token.surface, others, c.rnd)
  return {
    ...c.common,
    type: 'cloze_choice',
    before: s.tokens.slice(0, blank),
    after: s.tokens.slice(blank + 1),
    translation: modelAnswer(s.graphs.en),
    choices,
    answer,
  }
}

function completeChat(c: Ctx): ChallengeOf<'complete_chat'> {
  const chat = c.ix.chat(c.ref.items[0]!)
  const withEn = (s: CompiledSentence) => ({
    ...sentenceText(c.ix, s),
    en: modelAnswer(s.graphs.en),
  })
  const options = chat.options.map((id) => c.ix.sentence(id))
  const correct = options[chat.answer]
  if (!correct) throw new ContentError(`complete_chat ${chat.id}: answer out of range`)
  const { choices, answer } = withAnswer(
    correct,
    options.filter((_, i) => i !== chat.answer),
    c.rnd,
  )
  return {
    ...c.common,
    type: 'complete_chat',
    speaker: withImage(
      { id: chat.speaker, name: c.ix.characterName(chat.speaker) },
      c.ix.characterImage(chat.speaker),
    ),
    prompt: withEn(c.ix.sentence(chat.prompt)),
    choices: choices.map(withEn),
    answer,
  }
}

/** Adds `image` only when there is one, so challenges without portraits stay byte-identical. */
function withImage<T extends object>(o: T, image: string | undefined): T & { image?: string } {
  return image === undefined ? o : { ...o, image }
}

function exampleWords(ix: ContentIndex, letter: Letter): Lexeme[] {
  return letter.examples.flatMap((id) => (ix.lexemes.has(id) ? [ix.lexeme(id)] : []))
}

function letterIntro(c: Ctx): ChallengeOf<'letter_intro'> {
  const letter = c.ix.letter(c.ref.items[0]!)
  const examples = exampleWords(c.ix, letter)
    .slice(0, 3)
    .map((l) => ({ ...lexemeText(c.ix, l), en: gloss(l) }))
  return { ...c.common, type: 'letter_intro', letter: letterInfo(c.ix, letter), examples }
}

/** Letters to confuse with `letter`: other letters with a different sound, near it in teaching order. */
function letterDistractors(c: Ctx, letter: Letter, value: (l: Letter) => string): Letter[] {
  const others = c.ix.letterList.filter((l) => l.id !== letter.id && value(l) !== value(letter))
  const sorted = pickBest(
    others,
    Number.MAX_SAFE_INTEGER,
    (l) =>
      (l.family !== undefined && l.family === letter.family ? 0 : 1) +
      Math.min(9, Math.abs(l.order - letter.order)) / 10,
    c.rnd,
  )
  return distinctBy(sorted, CHOICES - 1, value, [value(letter)])
}

function letterSound(c: Ctx): ChallengeOf<'letter_sound'> {
  const letter = c.ix.letter(c.ref.items[0]!)
  const mode = c.option === 1 ? 'sound_to_letter' : 'letter_to_sound'
  const value = mode === 'letter_to_sound' ? (l: Letter) => l.translit : (l: Letter) => l.letter
  const others = letterDistractors(c, letter, value)
  requireChoices(others.length, `letter_sound ${letter.id}`)
  const { choices, answer } = withAnswer(value(letter), others.map(value), c.rnd)
  return {
    ...c.common,
    type: 'letter_sound',
    mode,
    letter: letterInfo(c.ix, letter),
    choices,
    answer,
  }
}

function letterFormsChallenge(c: Ctx): ChallengeOf<'letter_forms'> {
  const letters = c.ref.items.slice(0, MAX_PAIRS).map((id) => c.ix.letter(id))
  let pairs: { left: string; right: string }[]
  if (letters.length >= 2) {
    // Each letter's isolated form to one of its joined forms (connectors: initial/medial/final).
    pairs = letters.map((l) => {
      const f = letterInfo(c.ix, l).forms
      const joined = l.connects ? [f.initial, f.medial, f.final] : [f.final]
      return { left: f.isolated, right: joined[Math.floor(c.rnd() * joined.length)]! }
    })
  } else {
    // One letter: each form name to its shape (distinct shapes only).
    const f = letterInfo(c.ix, letters[0]!).forms
    pairs = distinctBy(
      (['isolated', 'initial', 'medial', 'final'] as const).map((k) => ({ left: k, right: f[k] })),
      MAX_PAIRS,
      (p) => p.right,
    )
  }
  if (
    pairs.length < 2 ||
    new Set(pairs.map((p) => p.right)).size < pairs.length ||
    new Set(pairs.map((p) => p.left)).size < pairs.length
  ) {
    throw new ContentError(`letter_forms ${c.ref.items.join(',')}: ambiguous pairs`)
  }
  return { ...c.common, type: 'letter_forms', pairs }
}

function readWord(c: Ctx): ChallengeOf<'read_word'> {
  const target = c.ix.lexeme(c.ref.items[0]!)
  const ask = c.option === 1 ? 'meaning' : 'translit'
  const value = ask === 'meaning' ? gloss : (l: Lexeme) => l.translit
  const others = lexemeDistractors(c.ix, target, CHOICES - 1, c.rnd, {
    value,
    lang: 'en',
  }).map(value)
  requireChoices(others.length, `read_word ${target.id}`)
  const { choices, answer } = withAnswer(value(target), others, c.rnd)
  return {
    ...c.common,
    type: 'read_word',
    word: { ...lexemeText(c.ix, target), en: gloss(target) },
    ask,
    choices,
    answer,
  }
}

function buildWord(c: Ctx): ChallengeOf<'build_word'> {
  const target = c.ix.lexeme(c.ref.items[0]!)
  const answer = splitLetters(target.fa)
  if (answer.length === 0) throw new ContentError(`build_word ${target.id}: empty word`)
  const inWord = new Set(answer.map((t) => t.replace('‌', '')))
  const families = new Set(c.ix.letterList.filter((l) => inWord.has(l.letter)).map((l) => l.family))
  const extra = pickBest(
    c.ix.letterList.filter((l) => !inWord.has(l.letter)),
    BUILD_WORD_DISTRACTORS,
    (l) => (families.has(l.family) ? 0 : 1),
    c.rnd,
  ).map((l) => l.letter)
  const tiles = shuffle([...answer, ...extra], c.rnd)
  if (tiles.length < 2) throw new ContentError(`build_word ${target.id}: too few tiles`)
  return {
    ...c.common,
    type: 'build_word',
    target: { ...lexemeText(c.ix, target), en: gloss(target) },
    tiles,
    answer,
  }
}

export class NotImplementedError extends Error {}

/** Builds one runtime challenge from its compact ref. Deterministic for (ref, index, content). */
export function buildChallenge(ref: ChallengeRef, index: number, content: ContentView): Challenge {
  const { isNew, option } = decodeVariant(ref.variant)
  const c: Ctx = {
    ix: indexContent(content),
    ref,
    rnd: seededRandom(`${index}:${ref.type}:${ref.items.join(',')}`),
    common: { index, ref, isNew },
    option,
  }
  switch (ref.type) {
    case 'select_image':
      return selectImage(c)
    case 'select_translation':
      return selectTranslation(c)
    case 'translate_bank':
    case 'translate_type':
      return translate(c)
    case 'match_pairs':
      return matchPairs(c)
    case 'listen_tap':
      return listenTap(c)
    case 'cloze_choice':
      return clozeChoice(c)
    case 'complete_chat':
      return completeChat(c)
    case 'letter_intro':
      return letterIntro(c)
    case 'letter_sound':
      return letterSound(c)
    case 'letter_forms':
      return letterFormsChallenge(c)
    case 'read_word':
      return readWord(c)
    case 'build_word':
      return buildWord(c)
    default:
      throw new NotImplementedError(`challenge type not in the MVP: ${ref.type}`)
  }
}

/** Rebuilds a stored session's challenges from refs (server-side re-grading). */
export function rebuildChallenges(
  refs: readonly ChallengeRef[],
  content: ContentView,
): Challenge[] {
  return refs.map((r, i) => buildChallenge(r, i, content))
}
