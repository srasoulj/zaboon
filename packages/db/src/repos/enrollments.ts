/** enrollments: one row per learner × course; `content_version` drives lazy path migrations. */
import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '../index'
import * as schema from '../schema'
import { toIso } from './shared'

export interface Enrollment {
  userId: string
  courseId: string
  currentLevelId: string | null
  xpTotal: number
  contentVersion: number
  createdAt: string
  updatedAt: string
}

function toEnrollment(row: typeof schema.enrollments.$inferSelect): Enrollment {
  return { ...row, createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt) }
}

const byKey = (userId: string, courseId: string) =>
  and(eq(schema.enrollments.userId, userId), eq(schema.enrollments.courseId, courseId))

export async function getEnrollment(
  tx: Tx,
  userId: string,
  courseId: string,
): Promise<Enrollment | null> {
  const [row] = await tx.select().from(schema.enrollments).where(byKey(userId, courseId))
  return row ? toEnrollment(row) : null
}

export async function listEnrollments(tx: Tx, userId: string): Promise<Enrollment[]> {
  const rows = await tx
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, userId))
    .orderBy(schema.enrollments.createdAt)
  return rows.map(toEnrollment)
}

/** Returns the enrollment, creating it at `contentVersion` if the learner has none for the course. */
export async function ensureEnrollment(
  tx: Tx,
  userId: string,
  input: { courseId: string; contentVersion: number; currentLevelId?: string | null },
): Promise<Enrollment> {
  await tx
    .insert(schema.enrollments)
    .values({
      userId,
      courseId: input.courseId,
      contentVersion: input.contentVersion,
      currentLevelId: input.currentLevelId ?? null,
    })
    .onConflictDoNothing()
  const row = await getEnrollment(tx, userId, input.courseId)
  if (!row) throw new Error('enrollment vanished after insert') // unreachable under RLS for the owner
  return row
}

export async function updateEnrollment(
  tx: Tx,
  userId: string,
  courseId: string,
  patch: { currentLevelId?: string | null; contentVersion?: number },
): Promise<Enrollment | null> {
  const [row] = await tx
    .update(schema.enrollments)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(byKey(userId, courseId))
    .returning()
  return row ? toEnrollment(row) : null
}

/** Adds XP to the course total (at commit). Returns the new total, or null without an enrollment. */
export async function addEnrollmentXp(
  tx: Tx,
  userId: string,
  courseId: string,
  amount: number,
): Promise<number | null> {
  const [row] = await tx
    .update(schema.enrollments)
    .set({ xpTotal: sql`${schema.enrollments.xpTotal} + ${amount}`, updatedAt: sql`now()` })
    .where(byKey(userId, courseId))
    .returning({ xpTotal: schema.enrollments.xpTotal })
  return row?.xpTotal ?? null
}
