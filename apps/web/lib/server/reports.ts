/** Content reports (POST /api/reports) and their admin triage (GET/PATCH /api/admin/reports). */
import type { z } from 'zod'
import {
  IsoDateTime,
  ReportStatus,
  type AdminReportsResponse,
  type CreateReportRequest,
  type ReportDto,
} from '@zaboon/contracts'
import { repos, withSystem, withUser, type Db } from '@zaboon/db'
import { ApiError } from './errors'

type NewReport = z.output<typeof CreateReportRequest>

const same = (a: NewReport, b: z.output<typeof ReportDto>) =>
  a.itemRef === b.itemRef &&
  a.kind === b.kind &&
  a.sessionId === b.sessionId &&
  a.answer === b.answer &&
  a.text === b.text

/**
 * Files a report. Idempotent: an identical report of the caller's that is still `new` (e.g. an
 * outbox retry) returns the existing id instead of a duplicate.
 */
export function createReport(db: Db, userId: string, input: NewReport): Promise<{ id: string }> {
  return withUser(db, userId, async (tx) => {
    const open = (await repos.reports.listReportsForUser(tx, userId)).find(
      (r) => r.status === 'new' && same(input, r),
    )
    if (open) return { id: open.id }
    return repos.reports.createReport(tx, userId, input)
  })
}

/** Admin list: `?status=new|accepted|rejected`, `?before=<createdAt>` (paging), `?limit=1..500`. */
export function listReports(db: Db, req: Request): Promise<z.input<typeof AdminReportsResponse>> {
  const q = new URL(req.url).searchParams
  const opts: { status?: z.output<typeof ReportStatus>; before?: string; limit?: number } = {}
  const status = q.get('status')
  if (status !== null) {
    const s = ReportStatus.safeParse(status)
    if (!s.success) throw new ApiError('validation', 'invalid status')
    opts.status = s.data
  }
  const before = q.get('before')
  if (before !== null) {
    if (!IsoDateTime.safeParse(before).success) throw new ApiError('validation', 'invalid before')
    opts.before = before
  }
  const limit = q.get('limit')
  if (limit !== null) {
    const n = Number(limit)
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new ApiError('validation', 'invalid limit')
    opts.limit = n
  }
  return withSystem(db, async (tx) => ({ reports: await repos.reports.adminListReports(tx, opts) }))
}

export function updateReport(
  db: Db,
  id: string,
  status: z.output<typeof ReportStatus>,
): Promise<z.output<typeof ReportDto>> {
  return withSystem(db, async (tx) => {
    const report = await repos.reports.adminUpdateReport(tx, id, status)
    if (!report) throw new ApiError('not_found', 'report not found')
    return report
  })
}
