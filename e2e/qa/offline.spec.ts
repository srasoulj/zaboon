/**
 * Offline (ARCHITECTURE §10.2): a lesson completed while offline stays in the IndexedDB outbox, and
 * the app-wide outbox replayer (providers.tsx) delivers it on the next app start on ANY page, not
 * only /lesson. The player runs with the test renderers (the flow, not the renderers, is under test).
 */
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { expect, test, type Guest } from '../fixtures'

const FIRST_LESSON = '/lesson?course=fixture&kind=lesson&level=u01-s0'
/** u01-s0 pins four challenges (content/fixtures/README.md). */
const LENGTH = 4
/** Faster answers earn no XP (AppConfig.antiCheat.minMsPerChallenge = 800 ms). */
const HUMAN_MS = 900

async function xpTotal(request: APIRequestContext, guest: Guest): Promise<number> {
  const res = await request.get('/api/home', { headers: { authorization: guest.authorization } })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { xpTotal: number }).xpTotal
}

/** Plays u01-s0 perfectly and goes offline before the last Continue, which completes the lesson. */
async function finishOffline(page: Page, context: BrowserContext) {
  await page.addInitScript(() => window.localStorage.setItem('zaboon.testRenderers', '1'))
  await page.goto(FIRST_LESSON)
  for (let i = 0; i < LENGTH; i++) {
    await expect(page.getByTestId('test-renderer')).toHaveAttribute('data-phase', 'answering')
    await page.waitForTimeout(HUMAN_MS)
    await page.getByTestId('test-answer-correct').click()
    await page.getByTestId('lesson-check').click()
    await expect(page.getByTestId('lesson-feedback')).toBeVisible()
    if (i === LENGTH - 1) await context.setOffline(true)
    await page.getByTestId('lesson-feedback').getByRole('button', { name: 'Continue' }).click()
  }
  await expect(page.getByTestId('complete-summary')).toHaveAttribute('data-source', 'local')
}

for (const where of ['/learn', '/profile']) {
  test(`a completion queued offline is delivered after a restart on ${where}`, async ({
    guestPage: page,
    guest,
    context,
    request,
  }) => {
    await finishOffline(page, context)
    // The tab is closed while still offline: the lesson page never gets to replay it.
    await page.close()
    expect(await xpTotal(request, guest)).toBe(0)

    await context.setOffline(false)
    const next = await context.newPage()
    const delivered = next.waitForResponse(
      (r) => /\/api\/sessions\/[^/]+\/complete$/.test(r.url()) && r.request().method() === 'POST',
    )
    await next.goto(where)
    const res = await delivered
    expect(res.status()).toBe(200)
    expect(new URL(next.url()).pathname).not.toBe('/lesson')
    expect(await res.json()).toMatchObject({ xp: { total: 15 }, perfect: true })
    await expect.poll(() => xpTotal(request, guest)).toBe(15)

    // Delivered exactly once: another app start sends nothing more.
    let resent = 0
    await next.route(/\/api\/sessions\/[^/]+\/complete$/, (route) => {
      resent++
      return route.continue()
    })
    await next.reload()
    await expect(next.locator('body')).toBeVisible()
    await next.waitForTimeout(1500)
    expect(resent).toBe(0)
    expect(await xpTotal(request, guest)).toBe(15)
  })
}
