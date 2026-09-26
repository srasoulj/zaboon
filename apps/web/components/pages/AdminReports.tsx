'use client'
/**
 * /admin: content-report triage (LEARNING-ENGINE §4.5). Newest first, filtered by status, paged
 * with `before` (the last report's createdAt); each report can be accepted or rejected. The API
 * decides who is an admin: 401/403 shows "Not authorized".
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useId, useState } from 'react'
import type { z } from 'zod'
import type { ReportDto, ReportStatus } from '@zaboon/contracts'
import { Button3D } from '@zaboon/ui'
import { useApi, useSession } from '@/lib/app-services'
import { errorMessage } from './hooks'

type Report = z.output<typeof ReportDto>
type Status = z.output<typeof ReportStatus>
type Filter = Status | 'all'

export const ADMIN_PAGE_SIZE = 50
const adminReportsKey = (filter: Filter) => ['admin-reports', filter] as const

const KIND_LABELS: Record<Report['kind'], string> = {
  answer_should_be_accepted: 'My answer should be accepted',
  audio_problem: 'Audio problem',
  content_error: 'Content error',
  other: 'Other',
}

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

function isAuthError(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null
  return status === 401 || status === 403
}

function NotAuthorized() {
  return (
    <div className="flex flex-col gap-3" data-testid="admin-denied">
      <h1 className="text-2xl font-extrabold">Not authorized</h1>
      <p className="text-stone">This page is for Zaboon content admins.</p>
      <Link href="/" className="font-extrabold text-lajvard-500 underline dark:text-ink">
        Back to the home page
      </Link>
    </div>
  )
}

export function AdminReports() {
  const api = useApi()
  const session = useSession()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('new')
  const filterId = useId()
  const signedIn = session.status === 'signed_in'

  const reports = useInfiniteQuery({
    queryKey: adminReportsKey(filter),
    enabled: signedIn,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api('adminReports', {
        query: {
          status: filter === 'all' ? undefined : filter,
          before: pageParam,
          limit: String(ADMIN_PAGE_SIZE),
        },
      }),
    getNextPageParam: (last) =>
      last.reports.length === ADMIN_PAGE_SIZE ? last.reports.at(-1)?.createdAt : undefined,
    retry: false,
  })

  const update = useMutation({
    mutationFn: (v: { id: string; status: Status }) =>
      api('adminUpdateReport', { params: { id: v.id }, body: { status: v.status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
  })

  if (session.status === 'signed_out' || (reports.isError && isAuthError(reports.error)))
    return <NotAuthorized />

  const list = reports.data?.pages.flatMap((p) => p.reports) ?? []
  return (
    <div className="flex flex-col gap-6" data-testid="admin-reports">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-extrabold">Reports</h1>
        <div className="flex flex-col gap-1">
          <label htmlFor={filterId} className="font-bold">
            Status
          </label>
          <select
            id={filterId}
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="rounded-[var(--radius-tile)] border-2 border-line bg-surface px-3 py-2 font-bold"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {reports.isError && (
        <p role="alert" className="text-wrong-fg">
          {errorMessage(reports.error, "We couldn't load the reports.")}
        </p>
      )}
      {update.isError && (
        <p role="alert" className="text-wrong-fg">
          {errorMessage(update.error, "We couldn't update that report.")}
        </p>
      )}
      {(reports.isPending || !signedIn) && !reports.isError && (
        <p className="text-stone">Loading…</p>
      )}
      {reports.isSuccess && list.length === 0 && (
        <p className="text-stone">No reports here. Nice work!</p>
      )}

      <ul className="flex flex-col gap-3">
        {list.map((r) => (
          <li key={r.id}>
            <ReportCard
              report={r}
              busy={update.isPending && update.variables?.id === r.id}
              onSet={(status) => update.mutate({ id: r.id, status })}
            />
          </li>
        ))}
      </ul>

      {reports.hasNextPage && (
        <Button3D
          variant="ghost"
          loading={reports.isFetchingNextPage}
          onClick={() => void reports.fetchNextPage()}
        >
          Load more
        </Button3D>
      )}
    </div>
  )
}

function ReportCard({
  report,
  busy,
  onSet,
}: {
  report: Report
  busy: boolean
  onSet: (status: Status) => void
}) {
  const created = new Date(report.createdAt).toLocaleString('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
  return (
    <article
      className="flex flex-col gap-2 rounded-[var(--radius-card)] border-2 border-line p-4"
      data-testid="report"
      data-status={report.status}
      aria-label={`${KIND_LABELS[report.kind]}: ${report.itemRef}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-extrabold">{KIND_LABELS[report.kind]}</h2>
        <span className="rounded-full bg-surface px-3 py-1 text-sm font-extrabold uppercase">
          {report.status}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-stone">Item</dt>
        <dd className="font-mono break-all">{report.itemRef}</dd>
        {report.answer !== undefined && (
          <>
            <dt className="text-stone">Answer</dt>
            <dd className="break-words" dir="auto">
              {report.answer}
            </dd>
          </>
        )}
        {report.text !== undefined && (
          <>
            <dt className="text-stone">Note</dt>
            <dd className="break-words" dir="auto">
              {report.text}
            </dd>
          </>
        )}
        <dt className="text-stone">Sent</dt>
        <dd>{created} UTC</dd>
      </dl>
      <div className="flex gap-3">
        <Button3D
          variant={report.status === 'accepted' ? 'locked' : 'primary'}
          loading={busy}
          onClick={() => onSet('accepted')}
        >
          Accept
        </Button3D>
        <Button3D
          variant={report.status === 'rejected' ? 'locked' : 'ghost'}
          loading={busy}
          onClick={() => onSet('rejected')}
        >
          Reject
        </Button3D>
      </div>
    </article>
  )
}
