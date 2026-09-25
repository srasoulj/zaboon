import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Component gallery (apps/web/app/(dev)/gallery): visual baselines per section and theme, plus a
// few interaction and accessibility checks. Runs in the configured desktop and mobile projects.
const SECTIONS = ['buttons', 'choices', 'fatext', 'tiles', 'progress', 'feedback', 'path', 'stats', 'characters', 'overlays']
const THEMES = ['light', 'dark'] as const
const stylePath = fileURLToPath(new URL('./screenshot.css', import.meta.url))

test.use({ contextOptions: { reducedMotion: 'reduce' } })

async function openGallery(page: Page, theme: (typeof THEMES)[number] = 'light') {
  await page.goto(`/gallery?theme=${theme}`)
  await expect(page.locator('main[data-ready]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

for (const theme of THEMES) {
  test(`gallery screenshots (${theme})`, async ({ page }) => {
    await openGallery(page, theme)
    for (const id of SECTIONS) {
      const section = page.getByTestId(`gallery-${id}`)
      await section.scrollIntoViewIfNeeded()
      await expect(section).toHaveScreenshot(`${id}-${theme}.png`, { maxDiffPixelRatio: 0.01, stylePath })
    }
  })

  test(`gallery has no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await openGallery(page, theme)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
}

test('Persian text is marked up with lang and dir, words are never split', async ({ page }) => {
  await openGallery(page)
  const fa = page.getByTestId('gallery-fatext').locator('[lang="fa"][dir="rtl"]').first()
  await expect(fa).toBeVisible()
  const splitWords = await page.locator('.zb-fa__word').evaluateAll((els) => els.filter((e) => e.childNodes.length !== 1).length)
  expect(splitWords).toBe(0)
})

test('tiles fly to the answer line and back', async ({ page }) => {
  await openGallery(page)
  const tiles = page.getByTestId('gallery-tiles')
  const answer = tiles.getByRole('group', { name: 'Your answer' }).first()
  const bank = tiles.getByRole('group', { name: 'Word bank' }).first()
  await expect(answer).toHaveAttribute('dir', 'rtl')
  await bank.getByRole('button', { name: 'چای' }).click()
  await expect(answer.getByRole('button', { name: 'چای' })).toBeVisible()
  await expect(bank.getByRole('button', { name: 'چای' })).toHaveCount(0)
  await answer.getByRole('button', { name: 'چای' }).click()
  await expect(bank.getByRole('button', { name: 'چای' })).toBeVisible()
})

test('digit keys pick a choice; the modal traps focus and closes on Escape', async ({ page }) => {
  await openGallery(page)
  await page.keyboard.press('3')
  await expect(page.getByTestId('gallery-choices').getByRole('button', { name: 'tea' })).toHaveAttribute('aria-pressed', 'true')

  const opener = page.getByRole('button', { name: 'Quit lesson' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: "Wait, don't go!" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('tap-for-hint opens a bottom sheet with the gloss', async ({ page }) => {
  await openGallery(page)
  await page.getByTestId('gallery-fatext').getByRole('button', { name: 'آب' }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('water')
  await sheet.getByRole('button', { name: 'Got it' }).click()
  await expect(sheet).toHaveCount(0)
})
