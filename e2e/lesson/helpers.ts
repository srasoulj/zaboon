/**
 * Helpers for the lesson player specs. The player is driven through data-testids only: the
 * test renderer map (components/lesson/test-renderers.tsx, local auth mode) stands in for the real
 * renderers, so these specs test the flow and keep working whatever the renderers look like.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, type Guest } from '../fixtures'

export const FIRST_LESSON = '/lesson?course=fixture&kind=lesson&level=u01-s0'
/** u01-s0 pins four challenges (content/fixtures/README.md). */
export const FIRST_LESSON_LENGTH = 4
/**
 * The server's plausibility check awards no XP when the typical answer is faster than
 * AppConfig.antiCheat.minMsPerChallenge (800 ms), so the specs answer like a (fast) human.
 */
export const HUMAN_ANSWER_MS = 900

export async function useTestRenderers(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('zaboon.testRenderers', '1'))
}

export async function currentIndex(page: Page): Promise<number> {
  const renderer = page.getByTestId('test-renderer')
  await expect(renderer).toHaveAttribute('data-phase', 'answering')
  return Number(await renderer.getAttribute('data-index'))
}

/** Answers the current challenge and checks it; leaves the feedback bar open. */
export async function answer(page: Page, how: 'correct' | 'wrong', opts: { human?: boolean } = {}) {
  await expect(page.getByTestId('test-renderer')).toHaveAttribute('data-phase', 'answering')
  if (opts.human !== false) await page.waitForTimeout(HUMAN_ANSWER_MS)
  await page.getByTestId(`test-answer-${how}`).click()
  await page.getByTestId('lesson-check').click()
  await expect(page.getByTestId('lesson-feedback')).toBeVisible()
}

export async function continueLesson(page: Page) {
  await page.getByTestId('lesson-feedback').getByRole('button', { name: 'Continue' }).click()
}

export async function hearts(page: Page): Promise<string | null> {
  return page.getByTestId('lesson-hearts').getAttribute('data-count')
}

export async function home(request: APIRequestContext, guest: Guest) {
  const res = await request.get('/api/home', { headers: { authorization: guest.authorization } })
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    xpTotal: number
    lives: { count: number }
    streak: { current: number }
  }
}
