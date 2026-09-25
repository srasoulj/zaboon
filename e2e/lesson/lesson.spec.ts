/**
 * The lesson player end to end, through the real API with the fixture course's short first lesson
 * (u01-s0): a perfect run, a wrong answer (heart + re-queue), resume after reload, offline
 * completion replayed by the outbox, the quit dialog and running out of hearts.
 */
import { expect, test } from '../fixtures'
import {
  answer,
  continueLesson,
  currentIndex,
  FIRST_LESSON,
  FIRST_LESSON_LENGTH,
  hearts,
  home,
  useTestRenderers,
} from './helpers'

test.beforeEach(async ({ guestPage }) => {
  await useTestRenderers(guestPage)
})

test('a perfect lesson shows the complete screens and updates home XP', async ({ guestPage: page, guest, request }) => {
  await page.goto(FIRST_LESSON)
  await expect(page.getByTestId('lesson-player')).toBeVisible()
  await expect(page.getByTestId('lesson-check')).toHaveAttribute('data-variant', 'locked')
  expect(await hearts(page)).toBe('5')

  const seen: number[] = []
  for (let i = 0; i < FIRST_LESSON_LENGTH; i++) {
    seen.push(await currentIndex(page))
    await answer(page, 'correct')
    await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
    if (i === 2) await expect(page.getByText('3 in a row')).toBeVisible()
    // Enter continues (DESIGN-SYSTEM §8)
    if (i % 2 === 0) await page.keyboard.press('Enter')
    else await continueLesson(page)
  }
  expect(seen).toEqual([0, 1, 2, 3])

  const summary = page.getByTestId('complete-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute('data-source', 'server')
  await expect(page.getByTestId('complete-xp')).toHaveAttribute('data-value', '15')
  await expect(page.getByTestId('complete-accuracy')).toHaveAttribute('data-value', '100%')
  await page.getByTestId('complete-continue').click()

  await expect(page.getByTestId('complete-streak')).toBeVisible()
  await expect(page.getByTestId('streak-days')).toHaveAttribute('data-value', '1')
  await page.getByTestId('complete-continue').click()
  // 15 XP is below the default 20 XP goal, so there is no daily-goal screen: back to the path.
  await expect(page).toHaveURL(/\/(learn|onboarding)$/)

  const after = await home(request, guest)
  expect(after.xpTotal).toBe(15)
  expect(after.streak.current).toBe(1)
})

test('a wrong answer costs a heart and comes back at the end', async ({ guestPage: page, guest, request }) => {
  await page.goto(FIRST_LESSON)
  expect(await currentIndex(page)).toBe(0)
  await answer(page, 'wrong', { human: false })
  const feedback = page.getByTestId('lesson-feedback')
  await expect(feedback).toHaveAttribute('data-verdict', 'wrong')
  await expect(feedback.getByText('Correct solution:')).toBeVisible()
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
  await continueLesson(page)

  const order: number[] = []
  for (let i = 0; i < FIRST_LESSON_LENGTH; i++) {
    order.push(await currentIndex(page))
    await answer(page, 'correct', { human: false })
    await continueLesson(page)
  }
  expect(order).toEqual([1, 2, 3, 0])
  await expect(page.getByTestId('complete-summary')).toBeVisible()
  await expect(page.getByTestId('complete-accuracy')).toHaveAttribute('data-value', '75%')
  expect((await home(request, guest)).lives.count).toBe(4)
})

test('the report flag opens the report sheet and posts a report', async ({ guestPage: page }) => {
  await page.goto(FIRST_LESSON)
  await answer(page, 'wrong', { human: false })
  await page.getByRole('button', { name: 'Report a problem' }).click()
  await expect(page.getByTestId('report-sheet')).toBeVisible()
  await page.getByLabel('Something in the challenge is wrong').check()
  const posted = page.waitForResponse((r) => r.url().endsWith('/api/reports') && r.status() === 200)
  await page.getByTestId('report-submit').click()
  await posted
  await expect(page.getByText('Thanks for the report!')).toBeVisible()
})

test('reloading mid-lesson resumes where the learner left off', async ({ guestPage: page }) => {
  await page.goto(FIRST_LESSON)
  await answer(page, 'wrong', { human: false })
  await continueLesson(page)
  await answer(page, 'correct', { human: false })
  await continueLesson(page)
  const sessionId = await page.getByTestId('lesson-player').getAttribute('data-session')

  await page.reload()
  const player = page.getByTestId('lesson-player')
  await expect(player).toHaveAttribute('data-resumed', 'true')
  await expect(player).toHaveAttribute('data-session', sessionId!)
  expect(await currentIndex(page)).toBe(2)
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
  await expect(page.getByRole('progressbar', { name: 'Lesson progress' })).toHaveAttribute('aria-valuenow', '25')

  for (const expected of [2, 3, 0]) {
    expect(await currentIndex(page)).toBe(expected)
    await answer(page, 'correct', { human: false })
    await continueLesson(page)
  }
  await expect(page.getByTestId('complete-summary')).toHaveAttribute('data-source', 'server')
})

test('a lesson finished offline is saved when the connection returns', async ({ guestPage: page, guest, request, context }) => {
  await page.goto(FIRST_LESSON)
  for (let i = 0; i < FIRST_LESSON_LENGTH - 1; i++) {
    await answer(page, 'correct')
    await continueLesson(page)
  }
  await answer(page, 'correct')
  await context.setOffline(true)
  await continueLesson(page)

  const summary = page.getByTestId('complete-summary')
  await expect(summary).toHaveAttribute('data-source', 'local')
  await expect(page.getByText("You're offline")).toBeVisible()
  await expect(page.getByTestId('complete-xp')).toHaveAttribute('data-value', '15')
  expect((await home(request, guest)).xpTotal).toBe(0)

  await context.setOffline(false)
  await expect(summary).toHaveAttribute('data-source', 'server')
  await expect(page.getByText('Your progress is saved.')).toBeVisible()
  expect((await home(request, guest)).xpTotal).toBe(15)
})

test('Escape asks before quitting; staying keeps the lesson, quitting returns to the path', async ({ guestPage: page }) => {
  await page.goto(FIRST_LESSON)
  await currentIndex(page)
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog', { name: "Wait, don't go!" })
  await expect(dialog).toBeVisible()
  await page.getByTestId('quit-stay').click()
  await expect(dialog).toBeHidden()
  expect(await currentIndex(page)).toBe(0)

  await page.getByTestId('lesson-close').click()
  await expect(dialog).toBeVisible()
  await page.getByTestId('quit-confirm').click()
  await expect(page).toHaveURL(/\/(learn|onboarding)$/)
})

test('running out of hearts offers practice to earn one back', async ({ guestPage: page }) => {
  await page.goto(FIRST_LESSON)
  for (let i = 0; i < 5; i++) {
    await answer(page, 'wrong', { human: false })
    await continueLesson(page)
  }
  const modal = page.getByRole('dialog', { name: 'You ran out of hearts' })
  await expect(modal).toBeVisible()
  await page.getByTestId('hearts-practice').click()
  await expect(page).toHaveURL(/\/lesson\?course=fixture&kind=practice$/)
  await expect(page.getByTestId('lesson-player')).toBeVisible()
})
