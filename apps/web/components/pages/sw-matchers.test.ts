import { describe, expect, it } from 'vitest'
import { cacheBucket } from './sw-matchers'

const ORIGIN = 'https://zaboon.app'
function bucket(href: string, method = 'GET') {
  const url = new URL(href, ORIGIN)
  return cacheBucket({ url, method, sameOrigin: url.origin === ORIGIN })
}

describe('service worker caching', () => {
  it('caches hashed Next.js assets', () => {
    expect(bucket('/_next/static/chunks/app-1a2b3c.js')).toBe('app-assets')
    expect(bucket('/_next/static/css/9f8e7d.css')).toBe('app-assets')
    expect(bucket('/_next/static/media/nunito.4c3b2a.woff2')).toBe('app-assets')
  })

  it('caches versioned content and media, on any origin', () => {
    expect(bucket('/content/fa-en/v3/manifest.json')).toBe('content')
    expect(bucket('/content/fa-en/v3/assets/audio/salam.mp3')).toBe('content')
    expect(bucket('/content/fixture/v12/units/u01.json')).toBe('content')
    expect(
      bucket('https://cdn.example.com/storage/v1/object/public/content/fa-en/v4/assets/a.webp'),
    ).toBe('content')
  })

  it('never caches the API, auth, pages or unversioned content', () => {
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
      '/_next/image?url=%2Fx.png&w=64',
      '/_next/data/build/page.json',
    ])
      expect(bucket(path), path).toBeNull()
  })

  it('never caches cross-origin app assets or non-GET requests', () => {
    expect(bucket('https://evil.example.com/_next/static/chunks/x.js')).toBeNull()
    expect(bucket('/_next/static/chunks/x.js?v=1')).toBeNull()
    expect(bucket('/content/fa-en/v3/manifest.json', 'POST')).toBeNull()
    expect(bucket('/_next/static/chunks/x.js', 'HEAD')).toBeNull()
  })
})
