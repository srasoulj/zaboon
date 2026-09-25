/** mistakes (feeds practice sessions) and level_progress (lessons done per level). */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Tx } from '../index'
import * as schema from '../schema'
import { toIso, toIsoOrNull } from './shared'

// ---------------------------------------------------------------------------------------------
// Mistakes
// ---------------------------------------------------------------------------------------------
export interface Mistake {
  itemRef: string
  timesWrong: number
  lastWrongAt: string
  resolvedAt: string | null
}

function toMistake(r: typeof schema.mistakes.$inferSelect): Mistake {
  return {
    itemRef: r.itemRef,
    timesWrong: r.timesWrong,
    lastWrongAt: toIso(r.lastWrongAt),
    resolvedAt: toIsoOrNull(r.resolvedAt),
  }
}

/** Counts a wrong answer for each item and re-opens resolved ones. */
export async function recordMistakes(tx: Tx, userId: string, itemRefs: readonly string[], at: string): Promise<void> {
  const unique = [...new Set(itemRefs)]
  if (unique.length === 0) return
  const t = schema.mistakes
  await tx
    .insert(t)
    .values(unique.map((itemRef) => ({ userId, itemRef, timesWrong: 1, lastWrongAt: at })))
    .onConflictDoUpdate({
      target: [t.userId, t.itemRef],
      set: {
        timesWrong: sql`${t.timesWrong} + 1`,
        lastWrongAt: sql`greatest(${t.lastWrongAt}, excluded.last_wrong_at)`,
        resolvedAt: sql`NULL`,
      },
    })
}

/** Marks open mistakes on these items resolved (answered correctly in practice). */
export async function resolveMistakes(tx: Tx, userId: string, itemRefs: readonly string[], at: string): Promise<number> {
  if (itemRefs.length === 0) return 0
  const t = schema.mistakes
  const rows = await tx
    .update(t)
    .set({ resolvedAt: at })
    .where(and(eq(t.userId, userId), inArray(t.itemRef, [...itemRefs]), isNull(t.resolvedAt)))
    .returning({ itemRef: t.itemRef })
  return rows.length
}

/** Open mistakes, most recent first. */
export async function listOpenMistakes(tx: Tx, userId: string, limit = 50): Promise<Mistake[]> {
  const t = schema.mistakes
  const rows = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), isNull(t.resolvedAt)))
    .orderBy(desc(t.lastWrongAt), asc(t.itemRef))
    .limit(limit)
  return rows.map(toMistake)
}

// ---------------------------------------------------------------------------------------------
// Level progress
// ---------------------------------------------------------------------------------------------
export interface LevelProgress {
  courseId: string
  levelId: string
  lessonsDone: number
  legendary: boolean
  completedAt: string | null
  updatedAt: string
}

function toLevel(r: typeof schema.levelProgress.$inferSelect): LevelProgress {
  return {
    courseId: r.courseId,
    levelId: r.levelId,
    lessonsDone: r.lessonsDone,
    legendary: r.legendary,
    completedAt: toIsoOrNull(r.completedAt),
    updatedAt: toIso(r.updatedAt),
  }
}

export async function getLevelProgress(
  tx: Tx,
  userId: string,
  courseId: string,
  levelId: string,
): Promise<LevelProgress | null> {
  const t = schema.levelProgress
  const [row] = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.courseId, courseId), eq(t.levelId, levelId)))
  return row ? toLevel(row) : null
}

export async function listLevelProgress(tx: Tx, userId: string, courseId: string): Promise<LevelProgress[]> {
  const t = schema.levelProgress
  const rows = await tx
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.courseId, courseId)))
    .orderBy(asc(t.levelId))
  return rows.map(toLevel)
}

/**
 * Counts one completed lesson in a level, capped at `lessonsTotal`; sets completed_at the first time
 * the level reaches its total. Returns the level's progress after the update.
 */
export async function recordLessonDone(
  tx: Tx,
  userId: string,
  input: { courseId: string; levelId: string; lessonsTotal: number; at: string },
): Promise<LevelProgress> {
  const t = schema.levelProgress
  const total = Math.max(1, input.lessonsTotal)
  const [row] = await tx
    .insert(t)
    .values({
      userId,
      courseId: input.courseId,
      levelId: input.levelId,
      lessonsDone: 1,
      completedAt: total === 1 ? input.at : null,
      updatedAt: input.at,
    })
    .onConflictDoUpdate({
      target: [t.userId, t.courseId, t.levelId],
      set: {
        lessonsDone: sql`least(${t.lessonsDone} + 1, ${total})`,
        completedAt: sql`coalesce(${t.completedAt}, CASE WHEN ${t.lessonsDone} + 1 >= ${total} THEN excluded.updated_at END)`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning()
  return toLevel(row!)
}

/** Marks a level Legendary (after a passed legendary session). */
export async function setLegendary(
  tx: Tx,
  userId: string,
  input: { courseId: string; levelId: string; at: string },
): Promise<LevelProgress> {
  const t = schema.levelProgress
  const [row] = await tx
    .insert(t)
    .values({ userId, courseId: input.courseId, levelId: input.levelId, legendary: true, updatedAt: input.at })
    .onConflictDoUpdate({
      target: [t.userId, t.courseId, t.levelId],
      set: { legendary: true, updatedAt: sql`excluded.updated_at` },
    })
    .returning()
  return toLevel(row!)
}

/** Sets a level's lessons done directly (e.g. a passed "jump here" test completes skipped levels). */
export async function setLevelProgress(
  tx: Tx,
  userId: string,
  input: { courseId: string; levelId: string; lessonsDone: number; completed: boolean; at: string },
): Promise<LevelProgress> {
  const t = schema.levelProgress
  const [row] = await tx
    .insert(t)
    .values({
      userId,
      courseId: input.courseId,
      levelId: input.levelId,
      lessonsDone: input.lessonsDone,
      completedAt: input.completed ? input.at : null,
      updatedAt: input.at,
    })
    .onConflictDoUpdate({
      target: [t.userId, t.courseId, t.levelId],
      set: {
        lessonsDone: sql`greatest(${t.lessonsDone}, excluded.lessons_done)`,
        completedAt: sql`coalesce(${t.completedAt}, excluded.completed_at)`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning()
  return toLevel(row!)
}
