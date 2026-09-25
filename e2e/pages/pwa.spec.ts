/**
 * The service worker (/serwist/sw.js). Playwright blocks service workers by default, so this spec
 * opts in. PwaProvider only registers the worker in production builds, so the test registers it
 * itself and checks what it caches.
 */
import { expect, test } from '../fixtures'

test.use({ serviceWorkers: 'allow' })

test('the service worker is served and bundles the caching rules', async ({ request }) => {
  const res = await request.get('/serwist/sw.js')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('javascript')
  expect(res.headers()['service-worker-allowed']).toBe('/')
  const body = await res.text()
  expect(body).toContain('zaboon-app-assets-v1')
  expect(body).toContain('zaboon-content-v1')
  expect(body).toContain('/~offline')
})

test('the offline page is served', async ({ page }) => {
  await page.goto('/~offline')
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('the registered worker caches app assets and lesson media, never the API or pages', async ({
  page,
}) => {
  await page.goto('/alphabet')
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/serwist/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    return reg.scope
  })
  expect(new URL(scope).pathname).toBe('/')
  // clientsClaim: after a reload the page is controlled and its requests go through the worker.
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  // A real lesson media URL, resolved like the server does (manifest.assetsBase relative to the
  // bundle; the frozen fixture course is published at v1 by global-setup).
  const mediaPath = await page.evaluate(async () => {
    const base = new URL('/content/fixture/v1/manifest.json', location.origin)
    const manifest = (await (await fetch(base)).json()) as {
      assetsBase: string
      units: Record<string, string>
    }
    const unitFile = Object.values(manifest.units)[0]!
    const unit = await (await fetch(new URL(unitFile, base))).text()
    const ref = /"audio":"([^"]+)"/.exec(unit)![1]!
    const media = new URL(manifest.assetsBase + ref, base)
    await fetch(media)
    await fetch('/api/meta')
    await fetch('/alphabet/be')
    return media.pathname
  })
  expect(mediaPath).toMatch(/^\/content\/fixture\/assets\/audio\/.+\.[0-9a-f]{10}\.mp3$/)
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const urls: string[] = []
        for (const name of await caches.keys()) {
          const cache = await caches.open(name)
          for (const req of await cache.keys()) urls.push(new URL(req.url).pathname)
        }
        return urls
      }),
    )
    .toEqual(expect.arrayContaining([expect.stringMatching(/^\/_next\/static\//), mediaPath]))
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) urls.push(new URL(req.url).pathname)
    }
    return urls
  })
  expect(cached.filter((u) => u.startsWith('/api/'))).toEqual([])
  expect(cached).not.toContain('/alphabet/be')
  expect(cached).not.toContain('/alphabet')
  await page.evaluate(async () => {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister()
  })
})
