/** The marketing site, SEO files and the PWA manifest (static pages, no sign-in). */
import { fileURLToPath } from 'node:url'
import { expect, test } from '../fixtures'
import { THEMES, axeViolations } from './helpers'

const stylePath = fileURLToPath(new URL('./screenshot.css', import.meta.url))

test('the landing page has one h1 and its calls to action', async ({ page }) => {
  await page.goto('/')
  const h1 = page.locator('h1')
  await expect(h1).toHaveCount(1)
  await expect(h1).toContainText('Zaboon')
  await expect(h1).toContainText('Persian (Farsi)')
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/onboarding')
  await expect(main.getByRole('link', { name: 'I already have an account' })).toHaveAttribute(
    'href',
    '/sign-in',
  )
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Persian \(Farsi\)/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/)
  // No national flag and no other course's branding: the badge is the ز tile.
  await expect(page.getByText(/duolingo/i)).toHaveCount(0)
})

test('"I already have an account" opens the sign-in page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('main').getByRole('link', { name: 'I already have an account' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
})

test('the alphabet index links all 32 letters', async ({ page }) => {
  await page.goto('/alphabet')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Persian alphabet')
  await expect(page.getByRole('main').locator('a[href^="/alphabet/"]')).toHaveCount(32)
})

test('a letter page shows the letter, its forms and an example', async ({ page }) => {
  const res = await page.goto('/alphabet/be')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The letter be (ب)')
  await expect(page).toHaveTitle(/be \(ب\)/)
  const forms = page.getByRole('heading', { name: 'Its four forms' }).locator('..')
  await expect(forms.locator('[lang="fa"]')).toHaveCount(4)
  await expect(page.getByText('bābā')).toBeVisible()
  await page.getByRole('link', { name: /pe ›/ }).click()
  await expect(page).toHaveURL(/\/alphabet\/pe$/)
})

test('unknown letters are a 404', async ({ request }) => {
  expect((await request.get('/alphabet/nope')).status()).toBe(404)
})

test('Persian is marked up with lang="fa" dir="rtl"', async ({ page }) => {
  for (const path of ['/', '/alphabet', '/alphabet/ze', '/learn-persian']) {
    await page.goto(path)
    const persian = page.locator('[lang="fa"]')
    expect(await persian.count(), path).toBeGreaterThan(0)
    const bad = await persian.evaluateAll(
      (els) => els.filter((e) => e.getAttribute('dir') !== 'rtl').length,
    )
    expect(bad, path).toBe(0)
  }
})

test('robots.txt, sitemap.xml and the manifest are served', async ({ request }) => {
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  const robotsText = await robots.text()
  expect(robotsText).toContain('Disallow: /api/')
  expect(robotsText).toContain('Disallow: /admin')
  expect(robotsText).toMatch(/Sitemap: .*\/sitemap\.xml/)

  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  const xml = await sitemap.text()
  expect(xml).toContain('/alphabet/be</loc>')
  expect(xml).toContain('/learn-persian</loc>')
  expect(xml.match(/<loc>/g)).toHaveLength(3 + 32)

  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.status()).toBe(200)
  const m = (await manifest.json()) as {
    name: string
    short_name: string
    start_url: string
    display: string
    theme_color: string
    icons: { src: string; sizes: string; purpose?: string }[]
  }
  expect(m).toMatchObject({ short_name: 'Zaboon', display: 'standalone', theme_color: '#0E9F99' })
  expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  for (const icon of m.icons) {
    const r = await request.get(icon.src)
    expect(r.status(), icon.src).toBe(200)
    expect(r.headers()['content-type']).toBe('image/png')
  }
})

test('the admin page is not indexed', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

for (const theme of THEMES) {
  test(`marketing pages are accessible and match their baselines (${theme})`, async ({
    page,
    browserName,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    for (const [name, path] of [
      ['landing', '/'],
      ['letter-be', '/alphabet/be'],
      ['alphabet', '/alphabet'],
      ['learn-persian', '/learn-persian'],
      ['sign-in', '/sign-in'],
    ] as const) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      expect(await axeViolations(page, 'main'), path).toEqual([])
      if (browserName !== 'chromium' || name === 'alphabet' || name === 'learn-persian') continue
      await page.evaluate(() => document.fonts.ready)
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        stylePath,
      })
    }
  })
}
