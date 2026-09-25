import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheBucket, contentBaseOf } from './sw-matchers'

const ORIGIN = 'https://zaboon.app'
// A CDN base whose path has no `/content` segment (Supabase Storage-like).
const CDN_BASE = 'https://cdn.example.com/storage/v1/object/public/zaboon-media'

function bucket(href: string, method = 'GET', contentBases: readonly string[] = [CDN_BASE]) {
  const url = new URL(href, ORIGIN)
  return cacheBucket({ url, method, sameOrigin: url.origin === ORIGIN, contentBases })
}

// Media refs exactly as the content build writes them into unit bundles (<dir>/<name>.<hash>.<ext>).
const REFS = [
  'audio/lx_salam.3e1ee7f9c6.mp3',
  'audio/s_u01_0001.slow.5ab33558c1.mp3',
  'img/bread.decbac921a.svg',
  'characters/hodhod/neutral.0a1b2c3d4e.webp',
]
const bundle = {
  courseId: 'fixture',
  version: 1,
  bundlePath: 'fixture/v1',
  manifest: { assetsBase: '../assets/' },
}

/** The server's own mediaUrl (manifest.assetsBase is "../assets/"), with CONTENT_BASE_URL = `base`. */
async function serverMediaUrls(base: string): Promise<string[]> {
  vi.resetModules()
  vi.stubEnv('AUTH_MODE', 'local')
  vi.stubEnv('CONTENT_BASE_URL', base)
  const { mediaUrl } = await import('@/lib/server/content')
  return REFS.map((ref) => mediaUrl(bundle as Parameters<typeof mediaUrl>[0], ref))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('service worker caching', () => {
  it('caches the lesson media URLs the server hands out, served by the app itself', async () => {
    for (const url of await serverMediaUrls('')) {
      expect(url).toMatch(/^\/content\/fixture\/assets\//)
      expect(bucket(url), url).toBe('content')
    }
  })

  it('caches the lesson media URLs the server hands out from a CDN base without /content', async () => {
    for (const url of await serverMediaUrls(CDN_BASE)) {
      expect(url.startsWith(`${CDN_BASE}/fixture/assets/`), url).toBe(true)
      expect(bucket(url), url).toBe('content')
      // The same file anywhere else on that host, or with no base configured, is not cached.
      expect(bucket(url.replace('/zaboon-media/', '/other-bucket/'))).toBeNull()
      expect(bucket(url, 'GET', [])).toBeNull()
    }
  })

  it('caches hashed Next.js assets', () => {
    expect(bucket('/_next/static/chunks/app-1a2b3c.js')).toBe('app-assets')
    expect(bucket('/_next/static/css/9f8e7d.css')).toBe('app-assets')
    expect(bucket('/_next/static/media/nunito.4c3b2a.woff2')).toBe('app-assets')
  })

  it('caches versioned bundles below a content base only', () => {
    expect(bucket('/content/fa-en/v3/manifest.json')).toBe('content')
    expect(bucket('/content/fixture/v12/units/u01.json')).toBe('content')
    expect(bucket(`${CDN_BASE}/fa-en/v4/manifest.json`)).toBe('content')
    // Anchored: `/content/` must be the start of the path, the base must be a whole path prefix.
    expect(bucket('/x/content/fa-en/assets/audio/a.0123456789.mp3')).toBeNull()
    expect(bucket('/x/content/fa-en/v3/manifest.json')).toBeNull()
    expect(bucket(`${CDN_BASE}-evil/fa-en/v4/manifest.json`)).toBeNull()
    expect(bucket('https://cdn.example.com/content/fa-en/v4/manifest.json')).toBeNull()
    expect(
      bucket('https://evil.example.com/content/fa-en/assets/audio/x.0123456789.mp3'),
    ).toBeNull()
  })

  it('never caches the API, auth, pages or unhashed content', () => {
    for (const path of [
      '/api/home',
      '/api/sessions',
      '/api/content/fa-en/v3/x.json',
      '/api/dev/auth/anonymous',
      '/auth/callback',
      '/',
      '/learn',
      '/lesson?course=fa-en&kind=lesson&level=u01-l1',
      '/alphabet/be',
      '/manifest.webmanifest',
      '/serwist/sw.js',
      '/content/fa-en/manifest.json',
      '/content/fa-en/latest/manifest.json',
      '/content/fa-en/v3/',
      '/content/fa-en/assets/audio/salam.mp3',
      '/content/fa-en/assets/audio/salam.abc.mp3',
      '/content/fa-en/assets/audio/lx_ab.0123456789.mp3?v=2',
      '/_next/image?url=%2Fx.png&w=64',
      '/_next/data/build/page.json',
    ])
      expect(bucket(path), path).toBeNull()
  })

  it('never caches cross-origin app assets or non-GET requests', () => {
    expect(bucket('https://evil.example.com/_next/static/chunks/x.js')).toBeNull()
    expect(bucket(`${CDN_BASE}/_next/static/chunks/x.js`)).toBeNull()
    expect(bucket('/_next/static/chunks/x.js?v=1')).toBeNull()
    expect(bucket('/content/fa-en/v3/manifest.json', 'POST')).toBeNull()
    expect(bucket('/_next/static/chunks/x.js', 'HEAD')).toBeNull()
  })

  it('normalizes CONTENT_BASE_URL for the worker', () => {
    expect(contentBaseOf(`${CDN_BASE}/`)).toBe(CDN_BASE)
    expect(contentBaseOf('https://cdn.example.com')).toBe('https://cdn.example.com')
    expect(contentBaseOf('')).toBeNull()
    expect(contentBaseOf(undefined)).toBeNull()
    expect(contentBaseOf('not a url')).toBeNull()
    expect(contentBaseOf('javascript:alert(1)')).toBeNull()
  })
})
