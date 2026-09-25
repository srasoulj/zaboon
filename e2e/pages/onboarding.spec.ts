/** Onboarding (/onboarding): the full flow from /learn, the heritage fast track and the 13+ gate. */
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { THEMES, axeViolations, storedSession } from './helpers'

const stylePath = fileURLToPath(new URL('./screenshot.css', import.meta.url))

async function answer(page: Page, level: RegExp, age: string) {
  await expect(page.getByRole('heading', { name: 'Welcome to Zaboon' })).toBeVisible()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Culture, music and poetry' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: level }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Casual · 10 XP/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Your age').fill(age)
}

test('a new visitor onboards from /learn and lands in the first lesson', async ({
  page,
  request,
}) => {
  await page.goto('/learn')
  await expect(page).toHaveURL(/\/onboarding$/)
  await answer(page, /new to Persian/, '30')
  const posted = page.waitForResponse(
    (r) => r.url().endsWith('/api/onboarding') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Continue' }).click()
  expect((await posted).status()).toBe(200)
  // fa-en is AI-drafted: assert on the URL, never on course text.
  await expect(page).toHaveURL(/\/lesson\?course=fa-en&kind=lesson&level=[a-z0-9-]+$/)

  const session = await storedSession(page)
  const home = await request.get('/api/home', {
    headers: { authorization: `Bearer ${session!.accessToken}` },
  })
  const body = (await home.json()) as {
    user: { onboarded: boolean; ageConfirmed: boolean }
    dailyGoal: { goal: number }
    settings: { reason: string; selfLevel: string }
  }
  expect(body.user).toMatchObject({ onboarded: true, ageConfirmed: true })
  expect(body.dailyGoal.goal).toBe(10)
  expect(body.settings).toMatchObject({ reason: 'culture', selfLevel: 'new' })

  // The shell no longer sends this learner to onboarding, and onboarding sends them away.
  const homeLoaded = page.waitForResponse((r) => r.url().endsWith('/api/home') && r.ok())
  await page.goto('/learn')
  await homeLoaded
  const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true })
  await expect(nav.getByRole('link', { name: /learn/i })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/\/learn$/)
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/learn$/)
})

test('"I speak but can\'t read" goes to the Letters tab', async ({ page }) => {
  await page.goto('/onboarding')
  await answer(page, /speak Persian but can't read/, '45')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/letters$/)
})

test('when the guest sign-in on arrival failed, Continue says so and then signs the visitor in', async ({
  page,
}) => {
  // What production showed with anonymous sign-ins disabled: the shell's guest sign-in fails
  // silently and the age step's Continue stayed locked. Refuse the shell's attempt and the first
  // Continue; let the second one through.
  let refusals = 0
  let allow = false
  await page.route('**/api/dev/auth/anonymous', async (route) => {
    if (allow) return route.continue()
    refusals++
    await route.fulfill({
      status: 422,
      json: {
        code: 422,
        error_code: 'anonymous_provider_disabled',
        msg: 'Anonymous sign-ins are disabled',
      },
    })
  })
  await page.goto('/onboarding')
  await answer(page, /new to Persian/, '30')
  expect(await storedSession(page)).toBeNull()
  const cont = page.getByRole('button', { name: 'Continue' })
  await expect(cont).not.toHaveAttribute('aria-disabled', 'true')
  await cont.click()
  // Scoped: Next's route announcer is a role="alert" too.
  const alert = page.getByTestId('onboarding').getByRole('alert')
  await expect(alert).toContainText("couldn't sign you in as a guest")
  await expect(alert.getByRole('link', { name: 'sign in with your email' })).toHaveAttribute(
    'href',
    '/sign-in',
  )
  await expect(page).toHaveURL(/\/onboarding$/)

  allow = true
  const posted = page.waitForResponse(
    (r) => r.url().endsWith('/api/onboarding') && r.request().method() === 'POST',
  )
  await cont.click()
  expect((await posted).status()).toBe(200)
  await expect(page).toHaveURL(/\/lesson\?course=fa-en&kind=lesson&level=[a-z0-9-]+$/)
  expect(refusals).toBe(2)
  expect(await storedSession(page)).toMatchObject({ isAnonymous: true })
})

test('under 13 is blocked: nothing is posted, and the block is remembered', async ({ page }) => {
  const posts: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/api/onboarding')) posts.push(r.method())
  })
  await page.goto('/onboarding')
  await answer(page, /new to Persian/, '12')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: "Sorry, you can't use Zaboon yet" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: "Sorry, you can't use Zaboon yet" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0)
  expect(posts).toEqual([])
})

for (const theme of THEMES) {
  test(`onboarding is accessible and matches its baseline (${theme})`, async ({
    page,
    browserName,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.goto('/onboarding')
    await expect(page.getByRole('heading', { name: 'Welcome to Zaboon' })).toBeVisible()
    expect(await axeViolations(page, '[data-testid="onboarding"]')).toEqual([])
    await page.getByRole('button', { name: 'Get started' }).click()
    await page.getByRole('button', { name: 'Travel' }).click()
    expect(await axeViolations(page, '[data-testid="onboarding"]')).toEqual([])
    if (browserName !== 'chromium') return
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot(`onboarding-reason-${theme}.png`, {
      maxDiffPixelRatio: 0.01,
      stylePath,
    })
  })
}
