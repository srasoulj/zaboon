/**
 * Wave 3 accessibility and RTL with every flag on: axe (WCAG 2.2 A/AA tags) on the leaderboard,
 * quests, shop and practice hub, and on the lesson with the Persian keyboard open and with the
 * trace canvas; a typed Persian answer given with the keyboard only (Tab, Enter, Space on the
 * on-screen keys); every `[lang="fa"]` element has `dir="rtl"` and no Persian word is split across
 * elements on the new screens.
 */
import type { Locator, Page } from '@playwright/test'
import { expect, setTestFlags, setTestNow, test } from '../fixtures'
import { grantCoins, randomPastWeek } from '../engagement/helpers'
import { axeViolations, signInEmail, signInPage, uniqueEmail } from '../pages/helpers'
import {
  ALL_FLAGS,
  T1,
  ZWNJ,
  apiUser,
  challenge,
  expectType,
  feedbackThenContinue,
  guideReady,
  onboard10,
  persianMarkupProblems,
  playOn,
  reachT1,
} from './wave3-support'

test.use({ contextOptions: { reducedMotion: 'reduce' } })

/** Presses Tab until `target` has focus (wrapping), like a keyboard-only learner. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 150; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

test('the leaderboard, quests, shop and practice hub pass axe and the Persian text rules', async ({
  page,
  request,
}) => {
  const week = await randomPastWeek()
  const member = await signInEmail(request, uniqueEmail())
  const user = apiUser(member)
  await onboard10(request, user, week.now)
  // History for every screen: league XP, quest progress, coins and an open mistake.
  await playOn(request, user, ALL_FLAGS, { now: week.now, wrong: [0] })
  await grantCoins(user.id, 120)
  await setTestFlags(page, ALL_FLAGS)
  await setTestNow(page, week.now)
  await signInPage(page, member, '/leaderboard')

  const screens: [string, string][] = [
    ['/leaderboard', 'league-banner'],
    ['/quests', 'quests-reset'],
    ['/shop', 'shop-coins'],
    ['/practice', 'practice-hub'],
  ]
  for (const [path, ready] of screens) {
    if (path !== '/leaderboard') await page.goto(path)
    await expect(page.getByTestId(ready)).toBeVisible()
    if (path === '/practice')
      await expect(page.locator('[data-testid="practice-mode"]').first()).toBeVisible()
    expect(await axeViolations(page, '#main'), path).toEqual([])
    expect(await persianMarkupProblems(page, '#main'), path).toEqual([])
  }
})

test('the lesson with the Persian keyboard and the trace canvas: axe, keyboard only, RTL', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const member = await signInEmail(request, uniqueEmail())
  const user = apiUser(member)
  // League XP is on: play in an unused past week, never the current or a future one.
  const { now } = await randomPastWeek()
  await onboard10(request, user, now)
  await reachT1(request, user, now)
  await setTestFlags(page, ALL_FLAGS)
  await setTestNow(page, now)
  await signInPage(page, member, T1)

  // translate_type en→fa with the keyboard open.
  await expectType(page, 'translate_type')
  const box = challenge(page).getByRole('textbox', { name: 'Your answer in Persian' })
  const keys = challenge(page).getByRole('group', { name: 'Persian keyboard' })
  await expect(keys).toBeVisible()
  expect(await axeViolations(page, '[data-testid="lesson-player"]')).toEqual([])
  expect(await persianMarkupProblems(page, '[data-testid="lesson-player"]')).toEqual([])

  // Keyboard only: Tab to each on-screen key and press it with Enter or Space.
  const word = ['ن', 'و', 'ن', 'space', 'م', 'ی', 'half-space', 'خ', 'و', 'ا', 'م']
  for (const [i, k] of word.entries()) {
    await tabTo(page, keys.getByRole('button', { name: k, exact: true }))
    await page.keyboard.press(i % 2 ? 'Space' : 'Enter')
  }
  await expect(box).toHaveValue(`نون می${ZWNJ}خوام`)
  await tabTo(page, page.getByTestId('lesson-check'))
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  expect(await persianMarkupProblems(page, '[data-testid="lesson-player"]')).toEqual([])
  await page.keyboard.press('Enter') // CONTINUE has focus after CHECK
  await expectType(page, 'listen_type')

  await challenge(page)
    .getByRole('textbox', { name: 'What you hear, in Persian' })
    .fill(`چای می${ZWNJ}خوای`)
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')
  await expectType(page, 'cloze_type')
  expect(await persianMarkupProblems(page, '[data-testid="lesson-player"]')).toEqual([])
  await challenge(page).getByRole('textbox', { name: 'The missing word' }).fill('میخوام')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')

  // letter_trace: the canvas screen passes axe; "Can't trace now" keeps every heart.
  await expectType(page, 'letter_trace')
  await guideReady(challenge(page).getByTestId('trace-canvas'))
  expect(await axeViolations(page, '[data-testid="lesson-player"]')).toEqual([])
  expect(await persianMarkupProblems(page, '[data-testid="lesson-player"]')).toEqual([])
  const decline = challenge(page).getByRole('button', { name: "Can't trace now" })
  await tabTo(page, decline)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')
  await page.getByTestId('lesson-feedback').getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('complete-accuracy')).toHaveAttribute('data-value', '100%')
})
