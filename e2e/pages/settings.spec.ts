/** Settings (/settings): changes are saved through PATCH /api/settings and survive a reload. */
import { expect, test } from '../fixtures'
import { THEMES, axeViolations, onboard, signInPage, newGuest } from './helpers'

test('settings survive a reload', async ({ page, request }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await signInPage(page, guest, '/settings')

  await expect(page.getByLabel('Regular · 20 XP a day')).toBeChecked()
  const saved = () =>
    page.waitForResponse(
      (r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH',
    )
  let patch = saved()
  await page.getByText('Intense · 50 XP a day').click()
  expect((await patch).status()).toBe(200)
  // Without a reload, the shell's daily goal follows (home was invalidated). The card is on the
  // desktop rail only; the mobile project checks the API below.
  if ((page.viewportSize()?.width ?? 0) >= 1024)
    await expect(page.getByTestId('daily-goal')).toContainText('/ 50 XP')
  patch = saved()
  await page.getByRole('group', { name: 'Transliteration' }).getByText('Off').click()
  expect((await patch).status()).toBe(200)
  patch = saved()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  expect((await patch).status()).toBe(200)

  await page.reload()
  await expect(page.getByLabel('Intense · 50 XP a day')).toBeChecked()
  await expect(page.getByRole('group', { name: 'Transliteration' }).getByLabel('Off')).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  const homeRes = await request.get('/api/home', { headers: guest.headers })
  expect(((await homeRes.json()) as { dailyGoal: { goal: number } }).dailyGoal.goal).toBe(50)

  const res = await request.get('/api/settings', { headers: guest.headers })
  expect(await res.json()).toMatchObject({
    dailyGoalXp: 50,
    transliteration: 'off',
    motion: 'reduced',
  })
})

for (const theme of THEMES) {
  test(`settings, profile and account are accessible (${theme})`, async ({ page, request }) => {
    const guest = await newGuest(request)
    await onboard(request, guest)
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await signInPage(page, guest, '/settings')
    await expect(page.getByLabel('Regular · 20 XP a day')).toBeChecked()
    expect(await axeViolations(page, '[data-testid="settings"]')).toEqual([])
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Guest learner' })).toBeVisible()
    expect(await axeViolations(page, '[data-testid="profile"]')).toEqual([])
    await page.goto('/settings/account')
    await expect(page.getByRole('heading', { name: 'Create a profile' })).toBeVisible()
    expect(await axeViolations(page, '[data-testid="account"]')).toEqual([])
  })
}
