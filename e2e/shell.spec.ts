/** App shell: guest bootstrap, onboarding redirect and navigation (layout owned by the orchestrator). */
import { expect, test } from './fixtures'

test('a first-time visitor becomes a guest and is sent to onboarding', async ({ page }) => {
  await page.goto('/learn')
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByRole('heading', { name: 'Welcome to Zaboon' })).toBeVisible()
  const stored = await page.evaluate(() => window.localStorage.getItem('zaboon.session'))
  expect(JSON.parse(stored ?? 'null')).toMatchObject({ isAnonymous: true })
})

test('the shell shows navigation and live stats for a signed-in guest', async ({ guestPage }) => {
  await guestPage.route('**/api/home', async (route) => {
    // The onboarding route lands with ws-api/ws-pages; until then mark this guest onboarded.
    const res = await route.fetch()
    const json = (await res.json()) as { user: Record<string, unknown> }
    await route.fulfill({
      response: res,
      json: { ...json, user: { ...json.user, onboarded: true } },
    })
  })
  await guestPage.goto('/letters')
  const nav = guestPage.getByRole('navigation', { name: 'Main' }).filter({ visible: true })
  await expect(nav.getByRole('link', { name: /letters/i })).toHaveAttribute('aria-current', 'page')
  const stats = guestPage.getByTestId('stats').filter({ visible: true })
  await expect(stats.getByRole('img', { name: '0 day streak' })).toBeVisible()
  await expect(stats.getByRole('img', { name: '5 hearts' })).toBeVisible()
  await nav.getByRole('link', { name: /practice/i }).click()
  await expect(guestPage).toHaveURL(/\/practice$/)
  await expect(guestPage.getByRole('heading', { name: 'Practice' })).toBeVisible()
})
