import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Component gallery (apps/web/app/(dev)/gallery): visual baselines per section and theme, plus a
// few interaction and accessibility checks. Runs in the configured desktop and mobile projects.
const SECTIONS = ['buttons', 'choices', 'fatext', 'tiles', 'progress', 'feedback', 'path', 'stats', 'characters', 'overlays', 'keyboard']
const THEMES = ['light', 'dark'] as const
const stylePath = fileURLToPath(new URL('./screenshot.css', import.meta.url))

test.use({ contextOptions: { reducedMotion: 'reduce' } })

async function openGallery(page: Page, theme: (typeof THEMES)[number] = 'light') {
  await page.goto(`/gallery?theme=${theme}`)
  await expect(page.locator('main[data-ready]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

for (const theme of THEMES) {
  test(`gallery screenshots (${theme})`, async ({ page, browserName }) => {
    // Baselines are recorded in Chromium only (font rasterization differs per engine).
    if (browserName !== 'chromium') return
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
  await expect(page.locator('[lang="fa"]:not([dir="rtl"])')).toHaveCount(0)
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

test('the Persian keyboard types into the field and keeps it focused', async ({ page }) => {
  await openGallery(page)
  const echo = page.getByTestId('keyboard-echo')
  const kbd = page.getByRole('group', { name: 'Persian keyboard, phonetic', exact: true })
  const key = (name: string) => kbd.getByRole('button', { name, exact: true })
  await echo.click()
  await key('س').click()
  await key('ل').click()
  await key('ا').click()
  await key('م').click()
  await expect(echo).toHaveValue('سلام')
  await expect(echo).toBeFocused()
  await key('half-space').click()
  await key('space').click()
  await key('backspace').click()
  await expect(echo).toHaveValue('سلام\u200C')
  await key('shift').click()
  await expect(key('shift')).toHaveAttribute('aria-pressed', 'true')
  await key('ش').click() // Shift+S shows and types ش ("sh"), then Shift turns off
  await expect(key('shift')).toHaveAttribute('aria-pressed', 'false')
  await expect(echo).toHaveValue('سلام\u200Cش')
  await expect(echo).toBeFocused()
  await key('enter').click()
  await expect(page.getByText('Enter pressed 1 time', { exact: true })).toBeVisible()

  // Long press opens the variants; tapping one types it.
  const z = key('ز')
  await z.hover()
  await page.mouse.down()
  const variants = kbd.getByRole('group', { name: 'More letters like ز' })
  await expect(variants).toBeVisible()
  await page.mouse.up()
  await variants.getByRole('button', { name: 'ظ', exact: true }).click()
  await expect(echo).toHaveValue('سلام\u200Cشظ')
  await expect(variants).toHaveCount(0)
  await expect(echo).toBeFocused()
})

test('the Persian keyboard works from the keyboard alone', async ({ page }) => {
  await openGallery(page)
  const echo = page.getByTestId('keyboard-echo')
  const kbd = page.getByRole('group', { name: 'Persian keyboard, phonetic', exact: true })
  const key = (name: string) => kbd.getByRole('button', { name, exact: true })
  await key('ب').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press(' ') // Tab moved to the next key: ن
  await expect(echo).toHaveValue('بن')
  await key('ت').focus()
  await page.keyboard.press('ArrowUp')
  const variants = kbd.getByRole('group', { name: 'More letters like ت' })
  await expect(variants.getByRole('button', { name: 'ط', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(variants).toHaveCount(0)
  await expect(key('ت')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(echo).toHaveValue('بنط')
  await expect(key('ت')).toBeFocused()
  await key('enter').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Enter pressed 1 time', { exact: true })).toBeVisible()
})

test.describe('on a 360px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('the Persian keyboard fits without horizontal overflow', async ({ page }) => {
    await openGallery(page)
    for (const layout of ['phonetic', 'standard']) {
      const kbd = page.getByRole('group', { name: `Persian keyboard, ${layout}`, exact: true })
      await kbd.scrollIntoViewIfNeeded()
      const fits = await kbd.evaluate((el) => {
        const box = el.getBoundingClientRect()
        return [...el.querySelectorAll('button')].every((b) => {
          const r = b.getBoundingClientRect()
          return r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.width >= 20
        })
      })
      expect(fits, layout).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    // Keys stay usable targets (WCAG 2.5.8) at this width.
    const results = await new AxeBuilder({ page })
      .include('.zb-kbd')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})

test('a character portrait falls back to the placeholder when its image fails', async ({ page }) => {
  await openGallery(page)
  const characters = page.getByTestId('gallery-characters')
  const portrait = characters.getByTestId('portrait-image').getByRole('img', { name: 'Leila', exact: true })
  await expect(portrait).toHaveJSProperty('tagName', 'IMG')
  await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  const box = await portrait.boundingBox()
  expect([box?.width, box?.height]).toEqual([96, 96])
  // The broken URL renders the SVG placeholder in the same box.
  const fallback = characters.getByTestId('portrait-fallback').getByRole('img', { name: 'Leila, idle', exact: true })
  await expect(fallback.locator('svg')).toHaveAttribute('width', '96')
  const fallbackBox = await fallback.locator('svg').boundingBox()
  expect([fallbackBox?.width, fallbackBox?.height]).toEqual([96, 96])
  await expect(characters.locator('img[src$="missing-portrait.png"]')).toHaveCount(0)
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

test.describe('in-app reduce-animations toggle', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  const ANIMATED = ['.zb-node__start', '.zb-feedback', '.zb-progress__badge', '.zb-toast']
  const animationNames = (page: Page) =>
    page.evaluate(
      (sels) => sels.map((s) => getComputedStyle(document.querySelector(s)!).animationName),
      ANIMATED,
    )

  test('stops the CSS animations of the START bubble, feedback bar, streak badge and toast', async ({ page }) => {
    await openGallery(page)
    expect(await animationNames(page)).not.toContain('none')
    await page.getByRole('checkbox', { name: 'Reduce animations' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce')
    expect(await animationNames(page)).toEqual(ANIMATED.map(() => 'none'))
    await page.getByRole('checkbox', { name: 'Reduce animations' }).uncheck()
    await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'reduce')
    expect(await animationNames(page)).not.toContain('none')
  })
})
