/**
 * Content reports ("my answer should be accepted", audio problems, …). Learners create and list
 * their own; triage (list all, change status) is admin-only and requires system scope.
 */
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { CreateReportRequest, ReportDto, ReportStatus } from '@zaboon/contracts'
import type { z } from 'zod'
import type { Tx } from '../index'
import * as schema from '../schema'
import { NotFoundError, assertSystemScope, isUuid, toIso } from './shared'

export type NewReport = z.infer<typeof CreateReportRequest>
export type Report = z.infer<typeof ReportDto>
export type ReportStatusValue = z.infer<typeof ReportStatus>

function toDto(r: typeof schema.reports.$inferSelect): Report {
  return {
    id: r.id,
    itemRef: r.itemRef,
    kind: r.kind as Report['kind'],
    status: r.status as ReportStatusValue,
    createdAt: toIso(r.createdAt),
    ...(r.sessionId !== null ? { sessionId: r.sessionId } : {}),
    ...(r.answer !== null ? { answer: r.answer } : {}),
    ...(r.text !== null ? { text: r.text } : {}),
  }
}

/** Files a report. Throws NotFoundError when `sessionId` is given but is not the caller's session. */
export async function createReport(tx: Tx, userId: string, input: NewReport): Promise<{ id: string }> {
  if (input.sessionId !== undefined) {
    const [owned] = isUuid(input.sessionId)
      ? await tx
          .select({ id: schema.sessions.id })
          .from(schema.sessions)
          .where(and(eq(schema.sessions.id, input.sessionId), eq(schema.sessions.userId, userId)))
      : []
    if (!owned) throw new NotFoundError('session')
  }
  const [row] = await tx
    .insert(schema.reports)
    .values({
      userId,
      sessionId: input.sessionId ?? null,
      itemRef: input.itemRef,
      kind: input.kind,
      answer: input.answer ?? null,
      text: input.text ?? null,
    })
    .returning({ id: schema.reports.id })
  return { id: row!.id }
}

export async function listReportsForUser(tx: Tx, userId: string): Promise<Report[]> {
  const rows = await tx
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.userId, userId))
    .orderBy(desc(schema.reports.createdAt), desc(schema.reports.id))
  return rows.map(toDto)
}

// ---------------------------------------------------------------------------------------------
// Admin (system scope; the route checks the admin claim first)
// ---------------------------------------------------------------------------------------------
/** Newest first; filter by status; page with `before` (a createdAt from the previous page). */
export async function adminListReports(
  tx: Tx,
  opts: { status?: ReportStatusValue; limit?: number; before?: string } = {},
): Promise<Report[]> {
  await assertSystemScope(tx)
  const rows = await tx
    .select()
    .from(schema.reports)
    .where(
      and(
        opts.status ? eq(schema.reports.status, opts.status) : undefined,
        opts.before ? lt(schema.reports.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(schema.reports.createdAt), desc(schema.reports.id))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
  return rows.map(toDto)
}

/** Sets a report's status. Returns null when no such report exists. */
export async function adminUpdateReport(tx: Tx, id: string, status: ReportStatusValue): Promise<Report | null> {
  await assertSystemScope(tx)
  if (!isUuid(id)) return null
  const [row] = await tx
    .update(schema.reports)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(schema.reports.id, id))
    .returning()
  return row ? toDto(row) : null
}
