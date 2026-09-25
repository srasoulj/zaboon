/**
 * Learn path, Guidebook, Letters tab and Practice page against the running app (fixture course).
 * Each test onboards a fresh guest and finishes u01-s0 through the API first, which makes
 * `fixture` the active course. Never assert on fa-en text (it is AI-drafted and changes).
 */
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  expectNoAxeViolations,
  expectPersianMarkup,
  fontsReady,
  learnerAfterFirstLesson,
} from './helpers'

const stylePath = fileURLToPath(new URL('./screenshot.css', import.meta.url))
const THEMES = ['light', 'dark'] as const

test.use({ contextOptions: { reducedMotion: 'reduce' } })

const row = (page: Page, levelId: string) => page.locator(`[data-level="${levelId}"]`)
const node = (page: Page, levelId: string) => row(page, levelId).locator('button').first()

async function openLearn(page: Page) {
  await page.goto('/learn')
  await expect(page.getByTestId('learn-path')).toBeVisible()
  await fontsReady(page)
}

test.beforeEach(async ({ request, guest }) => {
  await learnerAfterFirstLesson(request, guest)
})

test('the path shows u01-s0 completed and u01-l1 current', async ({ guestPage: page }) => {
  await openLearn(page)
  await expect(page).toHaveURL(/\/learn$/)
  await expect(row(page, 'u01-s0')).toHaveAttribute('data-state', 'completed')
  await expect(row(page, 'u01-l1')).toHaveAttribute('data-state', 'current')
  await expect(row(page, 'u01-l2')).toHaveAttribute('data-state', 'locked')
  await expect(node(page, 'u01-l1')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByText('Section 1, Unit 1')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /Fixture unit/ })).toBeVisible()
  // The current node is scrolled into view.
  await expect(node(page, 'u01-l1')).toBeInViewport()
})

test('START on the current node opens the lesson player', async ({ guestPage: page }) => {
  await openLearn(page)
  await node(page, 'u01-l1').click()
  const dialog = page.getByRole('dialog', { name: 'Course challenges' })
  await expect(dialog.getByText('Lesson 1 of 1')).toBeVisible()
  await dialog.getByRole('link', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/lesson\?course=fixture&kind=lesson&level=u01-l1$/)
  await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 20_000 })
})

test('a locked node explains itself; Escape closes and returns focus', async ({
  guestPage: page,
}) => {
  await openLearn(page)
  await node(page, 'u01-l2').focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Letter challenges' })
  await expect(dialog.getByText('Complete the levels above to unlock this')).toBeVisible()
  await expect(dialog.getByRole('link')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(node(page, 'u01-l2')).toBeFocused()
})

test('the Guidebook renders its Persian phrases with audio', async ({ guestPage: page }) => {
  await openLearn(page)
  await page.getByRole('button', { name: /guidebook/i }).click()
  await expect(page).toHaveURL(/\/learn\/guidebook\/u01-fixture\?course=fixture$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Guidebook: Fixture unit' }),
  ).toBeVisible()
  const phrase = page.getByTestId('guidebook-phrase').first()
  await expect(phrase.locator('[lang="fa"]')).toHaveText('سلام، خوبی؟')
  await expect(phrase.getByRole('button', { name: 'Listen' })).toBeVisible()
  // The audio URL is a served, hashed bundle file.
  const res = await page.request.get(await audioUrl(page))
  expect(res.status()).toBe(200)
  await expectPersianMarkup(page)
})

test('the letters CTA opens the first letters lesson', async ({ guestPage: page }) => {
  await page.goto('/letters')
  await expect(page.getByTestId('letters-grid')).toBeVisible()
  await expect(page.locator('[data-letter]')).toHaveCount(10)
  await page.getByRole('link', { name: 'Learn the letters' }).click()
  await expect(page).toHaveURL(/\/lesson\?course=fixture&kind=letters&level=u01-letters-1$/)
  await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 20_000 })
})

test('practice START opens a practice session', async ({ guestPage: page }) => {
  await page.goto('/practice')
  await expect(page.getByRole('heading', { name: /practice/i })).toHaveCount(1)
  await expect(page.getByTestId('words-list')).toBeVisible()
  await page.getByRole('link', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/lesson\?course=fixture&kind=practice$/)
  await expect(page.getByTestId('lesson-player')).toBeVisible({ timeout: 20_000 })
})

const PAGES: { name: string; open(page: Page): Promise<void> }[] = [
  { name: 'learn', open: openLearn },
  {
    name: 'guidebook',
    async open(page) {
      await page.goto('/learn/guidebook/u01-fixture?course=fixture')
      await expect(page.getByTestId('guidebook-content')).toBeVisible()
      await fontsReady(page)
    },
  },
  {
    name: 'letters',
    async open(page) {
      await page.goto('/letters')
      await expect(page.getByTestId('letters-grid')).toBeVisible()
      await fontsReady(page)
    },
  },
  {
    name: 'practice',
    async open(page) {
      await page.goto('/practice')
      await expect(page.getByTestId('words-list')).toBeVisible()
      await fontsReady(page)
    },
  },
]

for (const p of PAGES)
  for (const theme of THEMES) {
    test(`${p.name}: no WCAG A/AA violations, Persian marked up (${theme})`, async ({
      guestPage: page,
    }) => {
      await page.emulateMedia({ colorScheme: theme })
      await p.open(page)
      if (p.name === 'learn') {
        // Check the popover too.
        await node(page, 'u01-l1').click()
        await expect(page.getByRole('dialog')).toBeVisible()
      }
      await expectNoAxeViolations(page)
      // The path itself shows no Persian text; the other pages must.
      await expectPersianMarkup(page, { requirePersian: p.name !== 'learn' })
    })

    test(`${p.name} screenshot (${theme})`, async ({ guestPage: page, browserName }) => {
      // Visual baselines are recorded for Chromium only; other engines run the behaviour checks.
      if (browserName !== 'chromium') return
      await page.emulateMedia({ colorScheme: theme })
      await p.open(page)
      await expect(page.locator('#main')).toHaveScreenshot(`${p.name}-${theme}.png`, {
        maxDiffPixelRatio: 0.01,
        stylePath,
      })
    })
  }

async function audioUrl(page: Page): Promise<string> {
  // The speaker plays the phrase's resolved URL; read it from the API the page used.
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('zaboon.session')
    return raw ? (JSON.parse(raw) as { accessToken: string }).accessToken : ''
  })
  const res = await page.request.get('/api/guidebooks/u01-fixture?courseId=fixture', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(200)
  const { markdown } = (await res.json()) as { markdown: string }
  const url = /<fa audio="([^"]+)"/.exec(markdown)?.[1]
  expect(url).toMatch(/^\/content\/fixture\/assets\/audio\/.+\.[0-9a-f]{10}\.mp3$/)
  return url!
}
