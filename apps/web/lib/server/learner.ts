/**
 * Learner memory for the session engine and the commit: FSRS cards, open mistakes and exposures in,
 * per-item SRS updates out (LEARNING-ENGINE §8). Scheduling itself is @zaboon/srs.
 */
import type { AppConfig, Challenge, FsrsCard, Verdict } from '@zaboon/contracts'
import { repos, type Tx } from '@zaboon/db'
import type { ContentView, LearnerState } from '@zaboon/session-engine'
import { newCard, outcomesByItem, ratingFor, review, type ItemAttempt } from '@zaboon/srs'

export async function loadLearnerState(tx: Tx, userId: string): Promise<LearnerState> {
  const lexemes = await repos.memory.getLexemeCards(tx, userId)
  const letters = await repos.memory.getLetterCards(tx, userId)
  const mistakes = await repos.learning.listOpenMistakes(tx, userId)
  return {
    lexemeCards: Object.fromEntries(lexemes.map((e) => [e.id, e.card])),
    letterCards: Object.fromEntries(letters.map((e) => [e.id, e.card])),
    mistakes: mistakes.map((m) => m.itemRef),
    exposures: Object.fromEntries(lexemes.map((e) => [e.id, e.exposures])),
  }
}

/** The SRS items (lexemes and letters) one challenge exercises. */
export function srsItems(
  challenge: Challenge,
  view: ContentView,
): { lexemes: string[]; letters: string[] } {
  const sentenceLexemes = (id: string): string[] => {
    const s =
      view.knownSentences.find((x) => x.id === id) ??
      view.unit?.sentences.find((x) => x.id === id)
    return s ? s.tokens.flatMap((t) => (t.lexeme ? [t.lexeme] : [])) : []
  }
  const lexemes = new Set<string>()
  const letters = new Set<string>()
  for (const id of challenge.ref.items) {
    if (id.startsWith('lx_')) lexemes.add(id)
    else if (id.startsWith('l_')) letters.add(id)
    else if (id.startsWith('s_')) sentenceLexemes(id).forEach((l) => lexemes.add(l))
    else if (id.startsWith('c_')) {
      const chat = view.unit?.chats.find((c) => c.id === id)
      if (chat) {
        const answer = chat.options[chat.answer]
        for (const sid of [chat.prompt, ...(answer ? [answer] : [])])
          sentenceLexemes(sid).forEach((l) => lexemes.add(l))
      }
    }
  }
  return { lexemes: [...lexemes], letters: [...letters] }
}

export interface GradedAttempt {
  index: number
  verdict: Verdict
  ms: number
  hinted: boolean
}

/**
 * Applies one FSRS review per exercised lexeme and letter (outcomesByItem → ratingFor → review).
 * Items whose attempts were all skipped are left alone. Exposures grow by the number of distinct
 * challenges that showed the item. Returns the number of cards written.
 */
export async function applySrs(
  tx: Tx,
  userId: string,
  input: {
    attempts: readonly GradedAttempt[]
    challenges: readonly Challenge[]
    view: ContentView
    now: Date
    config: AppConfig
  },
): Promise<{ lexemes: number; letters: number }> {
  const itemsByIndex = new Map<number, { lexemes: string[]; letters: string[] }>()
  const itemsOf = (index: number) => {
    let hit = itemsByIndex.get(index)
    if (!hit) {
      hit = srsItems(input.challenges[index]!, input.view)
      itemsByIndex.set(index, hit)
    }
    return hit
  }
  const lexemeAttempts: ItemAttempt[] = []
  const letterAttempts: ItemAttempt[] = []
  const shownIn = new Map<string, Set<number>>()
  for (const a of input.attempts) {
    const { lexemes, letters } = itemsOf(a.index)
    const push = (list: ItemAttempt[], key: string, item: string) => {
      list.push({ item, verdict: a.verdict, ms: a.ms, hinted: a.hinted })
      if (a.verdict !== 'skipped') {
        const set = shownIn.get(key) ?? new Set<number>()
        set.add(a.index)
        shownIn.set(key, set)
      }
    }
    for (const id of lexemes) push(lexemeAttempts, `lx:${id}`, id)
    for (const id of letters) push(letterAttempts, `l:${id}`, id)
  }

  const plan = async (
    attempts: ItemAttempt[],
    prefix: string,
    load: (ids: string[]) => Promise<repos.memory.MemoryEntry[]>,
  ) => {
    const outcomes = [...outcomesByItem(attempts)].filter(
      (e): e is [string, NonNullable<(typeof e)[1]>] => e[1] !== null,
    )
    const existing = new Map((await load(outcomes.map(([id]) => id))).map((e) => [e.id, e]))
    return outcomes.map(([id, outcome]) => {
      const prev = existing.get(id)
      const card: FsrsCard = review(
        prev?.card ?? newCard(input.now),
        ratingFor(outcome, input.config.srs.slowMs),
        input.now,
      )
      const exposures = (prev?.exposures ?? 0) + (shownIn.get(`${prefix}:${id}`)?.size ?? 0)
      return { id, card, exposures }
    })
  }

  const lexemeCards = await plan(lexemeAttempts, 'lx', (ids) =>
    repos.memory.getLexemeCards(tx, userId, ids),
  )
  const letterCards = await plan(letterAttempts, 'l', (ids) =>
    repos.memory.getLetterCards(tx, userId, ids),
  )
  await repos.memory.upsertLexemeCards(tx, userId, lexemeCards)
  await repos.memory.upsertLetterCards(tx, userId, letterCards)
  return { lexemes: lexemeCards.length, letters: letterCards.length }
}
