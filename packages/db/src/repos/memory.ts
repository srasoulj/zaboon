/**
 * FSRS memory: lexeme_memory (learner × lexeme) and letter_memory (learner × letter). Cards are
 * stored field-for-field as the contracts' FsrsCard; scheduling itself lives in @zaboon/srs.
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import type { FsrsCard } from '@zaboon/contracts'
import type { Tx } from '../index'
import * as schema from '../schema'
import { toIso, toIsoOrNull } from './shared'

export interface MemoryEntry {
  /** lexeme id (lexeme_memory) or letter id (letter_memory). */
  id: string
  card: FsrsCard
  /** Times the learner has seen the item (drives the transliteration fade). */
  exposures: number
}

/** Upserts accept duplicate ids; the last entry for an id wins. */
export interface MemoryUpsert {
  id: string
  card: FsrsCard
  /** Absolute exposure count; left unchanged when omitted. */
  exposures?: number
}

type FsrsRow = Pick<
  typeof schema.lexemeMemory.$inferSelect,
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'elapsedDays'
  | 'scheduledDays'
  | 'learningSteps'
  | 'reps'
  | 'lapses'
  | 'state'
  | 'lastReview'
  | 'exposures'
>

function toCard(r: FsrsRow): FsrsCard {
  return {
    due: toIso(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsedDays,
    scheduledDays: r.scheduledDays,
    learningSteps: r.learningSteps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    lastReview: toIsoOrNull(r.lastReview),
  }
}

function cardColumns(card: FsrsCard) {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
  }
}

/** Column-wise `excluded.*` assignments for an upsert of FSRS fields (+ exposures when given). */
function upsertSet(withExposures: boolean) {
  return {
    due: sql`excluded.due`,
    stability: sql`excluded.stability`,
    difficulty: sql`excluded.difficulty`,
    elapsedDays: sql`excluded.elapsed_days`,
    scheduledDays: sql`excluded.scheduled_days`,
    learningSteps: sql`excluded.learning_steps`,
    reps: sql`excluded.reps`,
    lapses: sql`excluded.lapses`,
    state: sql`excluded.state`,
    lastReview: sql`excluded.last_review`,
    updatedAt: sql`now()`,
    ...(withExposures ? { exposures: sql`excluded.exposures` } : {}),
  }
}

/**
 * One entry per id, the LAST one winning. A single INSERT … ON CONFLICT DO UPDATE that touches the
 * same row twice fails with 21000 and would abort the caller's whole commit transaction.
 */
function lastPerId(entries: readonly MemoryUpsert[]): MemoryUpsert[] {
  return [...new Map(entries.map((e) => [e.id, e])).values()]
}

// ---------------------------------------------------------------------------------------------
// Lexemes
// ---------------------------------------------------------------------------------------------
/** The learner's lexeme cards; all of them, or only `ids` when given. */
export async function getLexemeCards(tx: Tx, userId: string, ids?: readonly string[]): Promise<MemoryEntry[]> {
  if (ids && ids.length === 0) return []
  const t = schema.lexemeMemory
  const rows = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), ids ? inArray(t.lexemeId, [...ids]) : undefined))
    .orderBy(asc(t.lexemeId))
  return rows.map((r) => ({ id: r.lexemeId, card: toCard(r), exposures: r.exposures }))
}

/** Lexeme cards due at `now`, most overdue first. */
export async function listDueLexemes(tx: Tx, userId: string, now: string, limit = 50): Promise<MemoryEntry[]> {
  const t = schema.lexemeMemory
  const rows = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), lte(t.due, now)))
    .orderBy(asc(t.due))
    .limit(limit)
  return rows.map((r) => ({ id: r.lexemeId, card: toCard(r), exposures: r.exposures }))
}

export async function upsertLexemeCards(tx: Tx, userId: string, entries: readonly MemoryUpsert[]): Promise<void> {
  const t = schema.lexemeMemory
  const unique = lastPerId(entries)
  for (const withExposures of [true, false]) {
    const batch = unique.filter((e) => (e.exposures !== undefined) === withExposures)
    if (batch.length === 0) continue
    await tx
      .insert(t)
      .values(batch.map((e) => ({ userId, lexemeId: e.id, ...cardColumns(e.card), exposures: e.exposures ?? 0 })))
      .onConflictDoUpdate({ target: [t.userId, t.lexemeId], set: upsertSet(withExposures) })
  }
}

// ---------------------------------------------------------------------------------------------
// Letters
// ---------------------------------------------------------------------------------------------
export async function getLetterCards(tx: Tx, userId: string, ids?: readonly string[]): Promise<MemoryEntry[]> {
  if (ids && ids.length === 0) return []
  const t = schema.letterMemory
  const rows = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), ids ? inArray(t.letterId, [...ids]) : undefined))
    .orderBy(asc(t.letterId))
  return rows.map((r) => ({ id: r.letterId, card: toCard(r), exposures: r.exposures }))
}

export async function listDueLetters(tx: Tx, userId: string, now: string, limit = 50): Promise<MemoryEntry[]> {
  const t = schema.letterMemory
  const rows = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), lte(t.due, now)))
    .orderBy(asc(t.due))
    .limit(limit)
  return rows.map((r) => ({ id: r.letterId, card: toCard(r), exposures: r.exposures }))
}

export async function upsertLetterCards(tx: Tx, userId: string, entries: readonly MemoryUpsert[]): Promise<void> {
  const t = schema.letterMemory
  const unique = lastPerId(entries)
  for (const withExposures of [true, false]) {
    const batch = unique.filter((e) => (e.exposures !== undefined) === withExposures)
    if (batch.length === 0) continue
    await tx
      .insert(t)
      .values(batch.map((e) => ({ userId, letterId: e.id, ...cardColumns(e.card), exposures: e.exposures ?? 0 })))
      .onConflictDoUpdate({ target: [t.userId, t.letterId], set: upsertSet(withExposures) })
  }
}
