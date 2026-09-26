/**
 * Wave 3 acceptance with EVERY flag on (leagues, quests, shop, practiceHub, persianKeyboard,
 * letterTrace) in the real player: a member plays the fixture's u01-t1 (on-screen keyboard,
 * physical keys, the cloze blank, a scribbled trace that costs a heart, then a trace that follows
 * the guide), sees the complete sequence (summary → streak → daily goal → league → quests), and the
 * engagement reads, the leaderboard, the shop and every practice-hub mode work on top of it.
 * The member plays in an unused past league week (randomPastWeek), so no rollover matters here.
 */
import type { Page } from '@playwright/test'
import { expect, setTestFlags, setTestNow, test } from '../fixtures'
import { grantCoins, randomPastWeek } from '../engagement/helpers'
import { axeViolations, signInPage } from '../pages/helpers'
import { play, type Body } from './support'
import {
  ALL_FLAGS,
  T1,
  ZWNJ,
  challenge,
  drawStrokes,
  expectType,
  feedbackThenContinue,
  guideReady,
  guideStrokes,
  memberWithLessonQuest,
  persianMarkupProblems,
  reachT1,
  readOn,
  scribble,
} from './wave3-support'

const stats = (page: Page) => page.getByTestId('stats').filter({ visible: true })

test('every Wave 3 flag on: u01-t1, the complete sequence, leagues, quests, shop and practice hub', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const week = await randomPastWeek()
  const day1 = new Date(Date.parse(week.startsAt) + 1.5 * 86_400_000).toISOString()
  const day2 = week.now
  const { member, user } = await memberWithLessonQuest(request, day2)
  await reachT1(request, user, day1)

  await setTestFlags(page, ALL_FLAGS)
  await setTestNow(page, day2)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signInPage(page, member, T1)
  await expect(page.getByTestId('lesson-player')).toBeVisible()
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')

  // 1. translate_type en→fa with the on-screen keyboard.
  await expectType(page, 'translate_type')
  const box = challenge(page).getByRole('textbox', { name: 'Your answer in Persian' })
  const keys = challenge(page).getByRole('group', { name: 'Persian keyboard' })
  for (const k of ['ن', 'و', 'ن', 'space', 'م', 'ی', 'half-space', 'خ', 'و', 'ا', 'م'])
    await keys.getByRole('button', { name: k, exact: true }).click()
  await expect(box).toHaveValue(`نون می${ZWNJ}خوام`)
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')

  // 2. listen_type with physical keys (remapped to the standard layout); Enter checks.
  await expectType(page, 'listen_type')
  const heard = challenge(page).getByRole('textbox', { name: 'What you hear, in Persian' })
  await heard.focus()
  for (const k of ['BracketRight', 'KeyH', 'KeyD', 'Space', 'KeyL', 'KeyD'])
    await page.keyboard.press(k)
  await page.keyboard.press('Shift+Space')
  for (const k of ['KeyO', 'Comma', 'KeyH', 'KeyD']) await page.keyboard.press(k)
  await expect(heard).toHaveValue(`چای می${ZWNJ}خوای`)
  await page.keyboard.press('Enter')
  await feedbackThenContinue(page, 'correct')

  // 3. cloze_type: the inline blank.
  await expectType(page, 'cloze_type')
  await challenge(page).getByRole('textbox', { name: 'The missing word' }).fill('میخوام')
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'correct')

  // 4. letter_trace: a scribble fails and costs a heart; the re-queued trace follows the guide.
  await expectType(page, 'letter_trace')
  let canvas = challenge(page).getByTestId('trace-canvas')
  await guideReady(canvas)
  await drawStrokes(page, canvas, await scribble(canvas))
  await page.getByTestId('lesson-check').click()
  await feedbackThenContinue(page, 'wrong')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
  await expectType(page, 'letter_trace')
  canvas = challenge(page).getByTestId('trace-canvas')
  await guideReady(canvas)
  await drawStrokes(page, canvas, await guideStrokes(canvas))
  await page.getByTestId('lesson-check').click()
  await expect(page.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  await expect(page.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
  await page.getByTestId('lesson-feedback').getByRole('button', { name: 'Continue' }).click()

  // The complete sequence: summary → streak → daily goal → league → quests.
  const summary = page.getByTestId('complete-summary')
  await expect(summary).toHaveAttribute('data-source', 'server')
  await expect(page.getByTestId('complete-accuracy')).toHaveAttribute('data-value', '75%')
  const next = () => page.getByTestId('complete-continue').click()
  await next()
  await expect(page.getByTestId('complete-streak')).toBeVisible()
  await next()
  await expect(page.getByTestId('complete-goal')).toBeVisible()
  await expect(page.getByTestId('goal-progress')).toHaveText('10 / 10 XP today')
  await next()
  await expect(page.getByTestId('complete-league')).toBeVisible()
  await expect(page.getByTestId('league-change-title')).toHaveText('You joined a league!')
  await expect(page.getByTestId('league-change-rank')).toHaveAttribute('data-rank', '1')
  expect(await axeViolations(page, '[data-testid="complete-league"]')).toEqual([])
  expect(await persianMarkupProblems(page, '[data-testid="complete-league"]')).toEqual([])
  await next()
  await expect(page.getByTestId('complete-quests')).toBeVisible()
  await expect(page.getByTestId('quests-coins')).toHaveAttribute('data-value', '10')
  expect(await axeViolations(page, '[data-testid="complete-quests"]')).toEqual([])
  await next()
  await expect(page.getByTestId('complete-quests')).toBeHidden()

  // Back in the app without a reload: the stats bar shows the quest coins.
  await expect(stats(page).getByRole('img', { name: '10 coins' })).toBeVisible()
  if (test.info().project.name === 'chromium-desktop') {
    await expect(page.getByTestId('rail-league-rank')).toContainText('#1 · 10 XP')
    await expect(page.getByTestId('rail-quests')).toBeVisible()
  }

  // /api/home carries coins, league and quests; the quest coins are in the wallet.
  const home = await readOn(request, user, '/api/home', day2)
  expect(home.coins).toBe(10)
  expect(home.league).toMatchObject({ tier: 'mes', joined: true, rank: 1, weeklyXp: 10 })
  expect(home.quests).toContainEqual(
    expect.objectContaining({ id: 'lessons_1', completed: true, progress: 1 }),
  )
  expect((await readOn(request, user, '/api/shop', day2)).coins).toBe(10)

  // The leaderboard lists the learner.
  await page.goto('/leaderboard')
  const me = page.locator('[data-testid="league-member"][data-me="true"]')
  await expect(me).toContainText('(you)')
  await expect(me).toContainText('10 XP')

  // The shop: a streak freeze and a heart refill, bought from the UI.
  await grantCoins(user.id, 250)
  await page.goto('/shop')
  await expect(page.getByTestId('shop-coins')).toHaveAttribute('data-value', '260')
  const freeze = page.locator('[data-testid="shop-item"][data-item="streak_freeze"]')
  await expect(freeze.getByTestId('shop-owned')).toHaveText('1 / 2 equipped')
  await freeze.getByRole('button', { name: 'Buy streak freeze for 100 coins' }).click()
  await expect(freeze.getByTestId('shop-status')).toHaveText('Bought! You have 160 coins left.')
  await expect(freeze.getByTestId('shop-owned')).toHaveText('2 / 2 equipped')
  const hearts = page.locator('[data-testid="shop-item"][data-item="heart_refill"]')
  await hearts.getByRole('button', { name: 'Buy heart refill for 150 coins' }).click()
  await expect(hearts.getByTestId('shop-status')).toHaveText('Bought! You have 10 coins left.')
  await expect(stats(page).getByRole('button', { name: '5 hearts' })).toBeVisible()
  const after = await readOn(request, user, '/api/home', day2)
  expect(after).toMatchObject({ coins: 10, lives: { count: 5 }, streak: { freezes: 2 } })

  // The practice hub: each mode starts a practice session of its kinds. A mistake to drill first
  // (a wrong answer on the first challenge of u01-s0).
  const wrong = await play(request, user, { now: day2, wrong: [0] })
  const mistakes = new Set(
    [...(wrong.mistakes as string[]), 'letter:l_be'].map((m) => m.split(':')[1]!),
  )
  const expectations: Record<string, (s: Body) => void> = {
    mixed: (s) => expect((s.challenges as unknown[]).length).toBeGreaterThan(0),
    // The drill starts with the open mistakes and is topped up to a full practice session.
    mistakes: (s) => {
      const [first] = s.challenges as { type: string; ref: { items: string[] } }[]
      expect(
        first!.ref.items.some((i) => mistakes.has(i)),
        `${first!.type} drills ${first!.ref.items.join(',')}`,
      ).toBe(true)
      expect((s.challenges as unknown[]).length).toBeGreaterThan(1)
    },
    listening: (s) => {
      for (const c of s.challenges as { type: string }[])
        expect(['listen_tap', 'listen_type']).toContain(c.type)
    },
    typing: (s) => {
      for (const c of s.challenges as { type: string }[])
        expect(['translate_type', 'listen_type', 'cloze_type']).toContain(c.type)
    },
  }
  for (const [mode, check] of Object.entries(expectations)) {
    await page.goto('/practice')
    const card = page.locator(`[data-testid="practice-mode"][data-mode="${mode}"]`)
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/sessions') && r.request().method() === 'POST',
    )
    await card.getByRole('link').click()
    const res = await created
    expect(res.status(), mode).toBe(200)
    const session = (await res.json()) as Body
    expect(session.kind).toBe('practice')
    expect(JSON.parse(res.request().postData() ?? '{}')).toMatchObject({ kind: 'practice', mode })
    check(session)
    await expect(page.getByTestId('lesson-player')).toBeVisible()
  }
})
