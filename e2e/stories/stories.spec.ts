/**
 * The fixture's P2 story level u01-st1 (story st_u01_tea: 3 beats) in the real lesson player with
 * flags.stories on, reached from the Learn path:
 *
 * - beat 1: the lines appear one by one (Space continues), the English shows on tap, a wrong answer
 *   costs no heart and the same beat comes back at once; then the right answer;
 * - beat 2: digits choose, Enter checks; beat 3 (closing) is read through;
 * - the story earns XP (xp.base.story; one wrong answer, so no perfect bonus) and the node shows
 *   completed back on the path;
 * - axe (WCAG 2.0/2.1 A+AA, 2.2 AA) on the story screen, and every [lang=fa] has dir=rtl;
 * - with the flag off the node shows "Coming soon" and nothing to play.
 */
import AxeBuilder from '@axe-core/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, setTestFlags, test, type Guest } from '../fixtures'
import { onboard } from '../path/helpers'
import { play, type User } from '../qa/support'

const ST1 = 'u01-st1'
/** AppConfig.xp.base.story (DEFAULT_APP_CONFIG; the e2e project cannot import the packages). */
const STORY_XP = 15

/**
 * Onboards the guest (the Learn tab needs it) and plays every lesson level of the fixture unit
 * through the API (flags off), so the story level at its end is `available` (stories never block
 * the path, and are locked only after `current`).
 */
async function reachSt1(request: APIRequestContext, guest: Guest): Promise<void> {
  await onboard(request, guest)
  const user: User = {
    id: guest.userId,
    token: guest.accessToken,
    authorization: guest.authorization,
  }
  await play(request, user)
  await play(request, user, { levelId: 'u01-l1' })
  await play(request, user, { levelId: 'u01-l2' })
  await play(request, user, { kind: 'practice', levelId: 'u01-p1' })
  await play(request, user, { kind: 'unit_review', levelId: 'u01-r1' })
  await play(request, user, { levelId: 'u01-t1' })
  await play(request, user, { levelId: 'u01-v1' })
}

const row = (page: Page, id: string) => page.locator(`[data-level="${id}"]`)
const node = (page: Page, id: string) => row(page, id).locator('button').first()
const challenge = (page: Page) => page.getByTestId('lesson-challenge')
const lines = (page: Page) => challenge(page).getByTestId('story-line')
const feedback = (page: Page) => page.getByTestId('lesson-feedback')

async function openLearn(page: Page) {
  await page.goto('/learn')
  await expect(page.getByTestId('learn-path')).toBeVisible()
}

async function expectA11y(page: Page, label: string) {
  // A line that just appeared fades in: measure contrast once it has (idle loops never end).
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations, `${label}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([])
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[lang="fa"]'))
      .filter((el) => el.getAttribute('dir') !== 'rtl')
      .map((el) => el.outerHTML.slice(0, 120)),
  )
  expect(bad, `${label}: lang=fa without dir=rtl`).toEqual([])
}

async function expectBeat(page: Page, n: number) {
  await expect(challenge(page)).toHaveAttribute('data-type', 'story')
  await expect(challenge(page).getByText(`Part ${n} of 3`)).toBeVisible()
}

/** Faster answers earn no XP (AppConfig.antiCheat.minMsPerChallenge = 800 ms median). */
const HUMAN_MS = 900
const human = (page: Page) => page.waitForTimeout(HUMAN_MS)

async function checkThenContinue(page: Page, verdict: string) {
  await human(page)
  await page.getByTestId('lesson-check').click()
  await expect(feedback(page)).toHaveAttribute('data-verdict', verdict)
  await feedback(page).getByRole('button', { name: 'Continue' }).click()
}

test('u01-st1 with stories on: three beats, a free retry, XP and a completed node', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachSt1(request, guest)
  await setTestFlags(page, { stories: true })
  await openLearn(page)
  await expect(row(page, ST1)).toHaveAttribute('data-state', 'available')
  await node(page, ST1).click()
  const dialog = page.getByRole('dialog', { name: 'A cup of tea' })
  await dialog.getByRole('link', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/lesson\?course=fixture&kind=story&level=u01-st1$/)
  await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')

  // Beat 1: Leila «سلام، خوبی؟», then Space shows Hodhod «خوبم، مرسی» and the question.
  await expectBeat(page, 1)
  await expect(challenge(page).getByRole('heading', { name: 'A cup of tea' })).toBeVisible()
  await expect(lines(page)).toHaveCount(1)
  await expect(lines(page).first()).toHaveAttribute('data-speaker', 'leila')
  await expect(lines(page).first()).toContainText('خوبی؟')
  await expect(page.getByTestId('lesson-skip')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(lines(page)).toHaveCount(2)
  await expect(lines(page).nth(1)).toHaveAttribute('data-speaker', 'hodhod')
  const first = lines(page).first()
  await first.getByRole('button', { name: 'Show English' }).click()
  await expect(first.getByText('Hello, how are you?')).toBeVisible()
  const question = challenge(page).getByTestId('story-question')
  await expect(question).toContainText('How is Hodhod?')
  await expectA11y(page, 'story beat 1')

  // A wrong answer: no heart, no report flag, and the same beat again right away.
  await question.getByRole('button', { name: /^tired/ }).click()
  await human(page)
  await page.getByTestId('lesson-check').click()
  await expect(feedback(page)).toHaveAttribute('data-verdict', 'wrong')
  await expect(feedback(page).getByText('Try again.')).toBeVisible()
  await expect(feedback(page).getByRole('button', { name: 'Report a problem' })).toHaveCount(0)
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')
  await feedback(page).getByRole('button', { name: 'Continue' }).click()
  await expectBeat(page, 1)
  await expect(challenge(page)).toHaveAttribute('data-index', '0')
  await expect(lines(page)).toHaveCount(2)
  await question.getByRole('button', { name: /^good/ }).click()
  await checkThenContinue(page, 'correct')

  // Beat 2: Leila «چای می‌خوای؟» → "What does Leila offer?"; digit 1 picks, Enter checks.
  await expectBeat(page, 2)
  await expect(lines(page)).toHaveCount(1)
  await expect(question).toContainText('What does Leila offer?')
  await page.keyboard.press('1')
  await expect(question.getByRole('button', { name: /^tea/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await human(page)
  await page.keyboard.press('Enter')
  await expect(feedback(page)).toHaveAttribute('data-verdict', 'correct')
  await feedback(page).getByRole('button', { name: 'Continue' }).click()

  // Beat 3 (closing): read through, then CHECK.
  await expectBeat(page, 3)
  await expect(question).toHaveCount(0)
  await expect(page.getByTestId('lesson-check')).not.toHaveAttribute('aria-disabled', 'true')
  await expectA11y(page, 'story closing beat')
  const completed = page.waitForResponse(
    (r) => /\/api\/sessions\/[^/]+\/complete$/.test(r.url()) && r.request().method() === 'POST',
  )
  await checkThenContinue(page, 'correct')
  const result = (await (await completed).json()) as {
    xp: { total: number }
    perfect: boolean
    level: { levelId: string; completed: boolean } | null
    streak: { extendedToday: boolean }
    dailyGoal: { justMet: boolean }
  }
  expect(result.perfect).toBe(false)
  expect(result.level).toMatchObject({ levelId: ST1, completed: true })
  expect(result.xp.total).toBe(STORY_XP)
  const summary = page.getByTestId('complete-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute('data-source', 'server')
  await expect(page.getByTestId('complete-xp')).toHaveAttribute(
    'data-value',
    String(result.xp.total),
  )

  // Back on the path (through the streak/goal screens the result shows), the node is completed.
  const screens = 1 + Number(result.streak.extendedToday) + Number(result.dailyGoal.justMet)
  for (let i = 0; i < screens; i++) await page.getByTestId('complete-continue').click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(row(page, ST1)).toHaveAttribute('data-state', 'completed')
})

test('with stories off the story node shows "Coming soon"', async ({
  guestPage: page,
  guest,
  request,
}) => {
  await reachSt1(request, guest)
  await openLearn(page)
  await expect(row(page, ST1)).toHaveAttribute('data-state', 'available')
  await node(page, ST1).click()
  const dialog = page.getByRole('dialog', { name: 'A cup of tea' })
  await expect(dialog).toContainText('Coming soon')
  await expect(dialog.getByRole('link')).toHaveCount(0)
})
