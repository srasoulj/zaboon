/** Report triage (/admin). The local DB is shared and never reset: rows are found by a unique marker. */
import { expect, test } from '../fixtures'
import { axeViolations, newAdmin, newGuest, signInPage, unique } from './helpers'

test('a guest sees "Not authorized"', async ({ guestPage }) => {
  await guestPage.goto('/admin')
  await expect(guestPage.getByRole('heading', { name: 'Not authorized' })).toBeVisible()
  await expect(guestPage.getByTestId('report')).toHaveCount(0)
})

test('a visitor who is not signed in sees "Not authorized"', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Not authorized' })).toBeVisible()
})

test('an admin accepts a new report', async ({ page, request }) => {
  const marker = unique('e2e-report-')
  const reporter = await newGuest(request)
  const created = await request.post('/api/reports', {
    headers: reporter.headers,
    data: {
      itemRef: 'sentence:s_e2e_admin',
      kind: 'answer_should_be_accepted',
      answer: 'I want water',
      text: marker,
    },
  })
  expect(created.status(), await created.text()).toBe(200)
  const { id } = (await created.json()) as { id: string }

  const admin = await newAdmin(request)
  await signInPage(page, admin, '/admin')
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  await expect(page.getByLabel('Status')).toHaveValue('new')
  const card = page.getByTestId('report').filter({ hasText: marker })
  await expect(card).toHaveAttribute('data-status', 'new')
  expect(await axeViolations(page, '[data-testid="admin-reports"]')).toEqual([])

  const patched = page.waitForResponse((r) => r.url().endsWith(`/api/admin/reports/${id}`))
  await card.getByRole('button', { name: 'Accept' }).click()
  expect((await patched).status()).toBe(200)
  await expect(card).toHaveCount(0)

  await page.getByLabel('Status').selectOption('accepted')
  await expect(page.getByTestId('report').filter({ hasText: marker })).toHaveAttribute(
    'data-status',
    'accepted',
  )

  const check = await request.get('/api/admin/reports?status=accepted&limit=100', {
    headers: admin.headers,
  })
  const { reports } = (await check.json()) as { reports: { id: string; status: string }[] }
  expect(reports.find((r) => r.id === id)?.status).toBe('accepted')
})
