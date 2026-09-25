import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { mediaUrl as MediaUrl } from '@/lib/server/content'
import { cacheBucket, contentOriginOf } from './sw-matchers'

const ORIGIN = 'https://zaboon.app'
const CDN = 'https://cdn.example.com'
function bucket(href: string, method = 'GET') {
  const url = new URL(href, ORIGIN)
  return cacheBucket({ url, method, sameOrigin: url.origin === ORIGIN, contentOrigins: [CDN] })
}

// Media refs exactly as the content build writes them into unit bundles (<dir>/<name>.<hash>.<ext>),
// resolved by the server's own mediaUrl (manifest.assetsBase is "../assets/").
const REFS = [
  'audio/lx_salam.3e1ee7f9c6.mp3',
  'audio/s_u01_0001.slow.5ab33558c1.mp3',
  'img/bread.decbac921a.svg',
  'characters/hodhod/neutral.0a1b2c3d4e.webp',
]

describe('service worker caching', () => {
  let mediaUrl: typeof MediaUrl
  beforeAll(async () => {
    vi.stubEnv('AUTH_MODE', 'local')
    vi.stubEnv('CONTENT_BASE_URL', '')
    ;({ mediaUrl } = await import('@/lib/server/content'))
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  const bundle = (courseId: string, version: number) => ({
    courseId,
    version,
    bundlePath: `${courseId}/v${version}`,
    manifest: { assetsBase: '../assets/' },
  })

  it('caches the lesson media URLs the server hands out', () => {
    for (const ref of REFS) {
      const url = mediaUrl(bundle('fixture', 1) as Parameters<typeof mediaUrl>[0], ref)
      expect(url).toMatch(/^\/content\/fixture\/assets\//)
      expect(bucket(url), url).toBe('content')
    }
  })

  it('caches hashed Next.js assets', () => {
    expect(bucket('/_next/static/chunks/app-1a2b3c.js')).toBe('app-assets')
    expect(bucket('/_next/static/css/9f8e7d.css')).toBe('app-assets')
    expect(bucket('/_next/static/media/nunito.4c3b2a.woff2')).toBe('app-assets')
  })

  it('caches versioned bundles and media from this origin or the content origin only', () => {
    expect(bucket('/content/fa-en/v3/manifest.json')).toBe('content')
    expect(bucket('/content/fixture/v12/units/u01.json')).toBe('content')
    expect(bucket(`${CDN}/content/fa-en/assets/audio/lx_ab.0123456789.mp3`)).toBe('content')
    expect(bucket(`${CDN}/storage/v1/object/public/content/fa-en/v4/manifest.json`)).toBe('content')
    expect(
      bucket('https://evil.example.com/content/fa-en/assets/audio/x.0123456789.mp3'),
    ).toBeNull()
    expect(bucket('https://evil.example.com/content/fa-en/v3/manifest.json')).toBeNull()
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
    expect(bucket(`${CDN}/_next/static/chunks/x.js`)).toBeNull()
    expect(bucket('/_next/static/chunks/x.js?v=1')).toBeNull()
    expect(bucket('/content/fa-en/v3/manifest.json', 'POST')).toBeNull()
    expect(bucket('/_next/static/chunks/x.js', 'HEAD')).toBeNull()
  })

  it('derives the content origin from CONTENT_BASE_URL', () => {
    expect(contentOriginOf('https://cdn.example.com/storage/v1/object/public/content')).toBe(CDN)
    expect(contentOriginOf('')).toBeNull()
    expect(contentOriginOf(undefined)).toBeNull()
    expect(contentOriginOf('not a url')).toBeNull()
  })
})
