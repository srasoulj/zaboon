/**
 * P2 engagement pages in the browser (flags via setTestFlags): the leaderboard shows you after
 * your first XP, a completed quest shows up in the stats bar's coins, buying a streak freeze,
 * refilling hearts from the hearts popover, and axe + RTL checks on the new pages. Screenshot
 * baselines are Chromium-only (an early return elsewhere).
 */
import type { Page } from '@playwright/test'
import { expect, setTestFlags, setTestNow, test } from '../fixtures'
import {
  axeViolations,
  newGuest,
  onboard,
  signInEmail,
  signInPage,
  uniqueEmail,
  type User,
} from '../pages/helpers'
import { ENGAGEMENT_ON, grantCoins, loseHearts, playLesson, randomPastWeek } from './helpers'

const stylePath = 'e2e/pages/screenshot.css'

/** The stats row that is visible at this viewport (header on mobile, right rail on desktop). */
const stats = (page: Page) => page.getByTestId('stats').filter({ visible: true })

async function open(page: Page, user: User, path: string, now?: string) {
  await setTestFlags(page, ENGAGEMENT_ON)
  if (now) await setTestNow(page, now)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signInPage(page, user, path)
}

test('earning XP puts you on the leaderboard (tier banner, you, zones)', async ({
  page,
  request,
  browserName,
}) => {
  const week = randomPastWeek()
  const member = await signInEmail(request, uniqueEmail())
  await onboard(request, member)
  await playLesson(request, member, { flags: ENGAGEMENT_ON, now: week.now })
  await open(page, member, '/leaderboard', week.now)

  const banner = page.getByTestId('league-banner')
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText('Mes League مس')
  const fa = banner.locator('[lang="fa"]')
  await expect(fa).toHaveAttribute('dir', 'rtl')
  await expect(fa).toHaveText('مس')
  const me = page.locator('[data-testid="league-member"][data-me="true"]')
  await expect(me).toContainText('(you)')
  await expect(me).toContainText('15 XP')
  await expect(me).toHaveAttribute('data-zone', 'promote')
  expect(await axeViolations(page, '#main')).toEqual([])

  if (browserName !== 'chromium') return
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('#main')).toHaveScreenshot('leaderboard.png', {
    maxDiffPixelRatio: 0.01,
    stylePath,
  })
})

test('guests are invited to create a profile to join leagues', async ({ page, request }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await open(page, guest, '/leaderboard')
  await expect(
    page.getByRole('heading', { name: 'Create a profile to join leagues' }),
  ).toBeVisible()
  expect(await axeViolations(page, '#main')).toEqual([])
})

test('completing a quest shows its coins in the stats bar and on the quests page', async ({
  page,
  request,
}) => {
  let found: { user: User; total: number } | null = null
  for (let i = 0; i < 20 && !found; i++) {
    const guest = await newGuest(request)
    const r = await playLesson(request, guest, { flags: ENGAGEMENT_ON })
    if (r.coins && r.coins.earned > 0) found = { user: guest, total: r.coins.total }
  }
  expect(found).not.toBeNull()
  const { user, total } = found!
  await onboard(request, user)
  await open(page, user, '/quests')
  await expect(stats(page).getByRole('img', { name: `${total} coins` })).toBeVisible()
  const done = page.locator('[data-testid="quest"][data-completed="true"]')
  await expect(done.first()).toBeVisible()
  await expect(page.getByTestId('quests-reset')).toContainText('New quests in')
  expect(await axeViolations(page, '#main')).toEqual([])
})

test('buying a streak freeze in the shop', async ({ page, request, browserName }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await grantCoins(guest.userId, 250)
  await open(page, guest, '/shop')
  await expect(page.getByTestId('shop-coins')).toHaveAttribute('data-value', '250')
  const freeze = page.locator('[data-testid="shop-item"][data-item="streak_freeze"]')
  await expect(freeze.getByTestId('shop-owned')).toHaveText('1 / 2 equipped')
  expect(await axeViolations(page, '#main')).toEqual([])
  if (browserName === 'chromium') {
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('#main')).toHaveScreenshot('shop.png', {
      maxDiffPixelRatio: 0.01,
      stylePath,
    })
  }

  await freeze.getByRole('button', { name: 'Buy streak freeze for 100 coins' }).click()
  await expect(freeze.getByTestId('shop-status')).toHaveText('Bought! You have 150 coins left.')
  await expect(freeze.getByTestId('shop-owned')).toHaveText('2 / 2 equipped')
  await expect(freeze.getByTestId('shop-why')).toHaveText('You have the maximum')
  await expect(page.getByTestId('shop-coins')).toHaveAttribute('data-value', '150')
  await expect(stats(page).getByRole('img', { name: '150 coins' })).toBeVisible()
})

test('refilling hearts from the hearts popover', async ({ page, request }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await loseHearts(request, guest, 3)
  await grantCoins(guest.userId, 150)
  await open(page, guest, '/learn')
  const pill = stats(page).getByRole('button', { name: '2 hearts' })
  await pill.click()
  const popover = stats(page).getByTestId('hearts-popover')
  await expect(popover.getByTestId('hearts-count')).toHaveText('2 of 5')
  await expect(popover.getByTestId('hearts-next')).toContainText('Next heart in')
  await popover.getByRole('button', { name: 'Refill hearts for 150 coins' }).click()
  await expect(popover.getByTestId('hearts-status')).toHaveText('Hearts refilled!')
  await expect(stats(page).getByRole('button', { name: '5 hearts' })).toBeVisible()
  await expect(stats(page).getByRole('img', { name: '0 coins' })).toBeVisible()
})

test('the practice hub opens a practice session with its mode', async ({ page, request }) => {
  const guest = await newGuest(request)
  await onboard(request, guest)
  await open(page, guest, '/practice')
  const mixed = page.locator('[data-testid="practice-mode"][data-mode="mixed"]').getByRole('link')
  await expect(mixed).toHaveAttribute('href', /kind=practice&mode=mixed/)
  expect(await axeViolations(page, '#main')).toEqual([])
})
