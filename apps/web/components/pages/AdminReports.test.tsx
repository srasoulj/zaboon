import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminReports, ADMIN_PAGE_SIZE } from './AdminReports'
import { apiError, fakeApi, fakeAuth, renderWith, session } from './test-support'

afterEach(() => cleanup())

type Status = 'new' | 'accepted' | 'rejected'
interface Row {
  id: string
  itemRef: string
  kind: 'answer_should_be_accepted' | 'audio_problem' | 'content_error' | 'other'
  status: Status
  createdAt: string
  text?: string
  answer?: string
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function rows(n: number, status: Status = 'new', start = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: id(start + i),
    itemRef: `sentence:s_${start + i}`,
    kind: 'answer_should_be_accepted',
    status,
    // Newest first.
    createdAt: new Date(Date.UTC(2026, 8, 20) - (start + i) * 60_000).toISOString(),
    answer: 'I want water',
    text: `note ${start + i}`,
  }))
}

function setup(data: Row[], opts: { deny?: boolean } = {}) {
  const store = [...data]
  const fake = fakeApi({
    adminReports: (o) => {
      if (opts.deny) throw apiError('forbidden', 403)
      const q = o.query ?? {}
      const list = store
        .filter((r) => !q.status || r.status === q.status)
        .filter((r) => !q.before || r.createdAt < q.before)
      return { reports: list.slice(0, Number(q.limit ?? 50)) }
    },
    adminUpdateReport: (o) => {
      const r = store.find((x) => x.id === o.params!.id)!
      r.status = (o.body as { status: Status }).status
      return r
    },
  })
  const auth = fakeAuth(session({ isAnonymous: false, email: 'admin@example.com' }))
  return { ...fake, ...renderWith(<AdminReports />, { api: fake.api, auth }), store }
}

describe('AdminReports', () => {
  it('shows "Not authorized" on a 403', async () => {
    setup(rows(2), { deny: true })
    expect(await screen.findByRole('heading', { name: 'Not authorized' })).toBeInTheDocument()
  })

  it('shows "Not authorized" when nobody is signed in (and never calls the API)', async () => {
    const fake = fakeApi({})
    renderWith(<AdminReports />, { api: fake.api, auth: fakeAuth(null) })
    expect(await screen.findByRole('heading', { name: 'Not authorized' })).toBeInTheDocument()
    expect(fake.calls).toEqual([])
  })

  it('lists new reports, newest first, and filters by status', async () => {
    const { called } = setup([...rows(2), ...rows(1, 'accepted', 10)])
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(2))
    expect(called('adminReports')[0]).toEqual({
      query: { status: 'new', before: undefined, limit: String(ADMIN_PAGE_SIZE) },
    })
    expect(screen.getAllByTestId('report')[0]).toHaveTextContent('note 0')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'accepted' } })
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(1))
    expect(screen.getByTestId('report')).toHaveTextContent('note 10')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(3))
    expect(called('adminReports').at(-1)!.query!.status).toBeUndefined()
  })

  it('accepts and rejects a report', async () => {
    const { called } = setup(rows(2))
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(2))
    const first = screen.getAllByTestId('report')[0]!
    fireEvent.click(within(first).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(1))
    expect(called('adminUpdateReport')).toEqual([
      { params: { id: id(0) }, body: { status: 'accepted' } },
    ])
    fireEvent.click(within(screen.getByTestId('report')).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(screen.getByText(/No reports here/)).toBeInTheDocument())
    expect(called('adminUpdateReport').at(-1)).toEqual({
      params: { id: id(1) },
      body: { status: 'rejected' },
    })
  })

  it('pages with "before"', async () => {
    const { called } = setup(rows(ADMIN_PAGE_SIZE + 3))
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(ADMIN_PAGE_SIZE))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByTestId('report')).toHaveLength(ADMIN_PAGE_SIZE + 3))
    expect(called('adminReports').at(-1)!.query!.before).toBe(
      rows(ADMIN_PAGE_SIZE)[ADMIN_PAGE_SIZE - 1]!.createdAt,
    )
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})
