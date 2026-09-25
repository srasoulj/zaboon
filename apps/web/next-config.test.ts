import { afterEach, describe, expect, it, vi } from 'vitest'

/** next.config.ts reads the environment when it loads, so each case re-imports it. */
async function loadConfig(contentBase: string | undefined) {
  vi.resetModules()
  if (contentBase === undefined) delete process.env.CONTENT_BASE_URL
  else process.env.CONTENT_BASE_URL = contentBase
  return (await import('./next.config')).default
}

describe('next.config env', () => {
  const saved = process.env.CONTENT_BASE_URL
  afterEach(() => {
    if (saved === undefined) delete process.env.CONTENT_BASE_URL
    else process.env.CONTENT_BASE_URL = saved
  })

  it('inlines the server content base for the browser', async () => {
    const config = await loadConfig('https://cdn.example.test/storage/v1/object/public/content')
    expect(config.env).toEqual({
      NEXT_PUBLIC_CONTENT_BASE_URL: 'https://cdn.example.test/storage/v1/object/public/content',
    })
  })

  it('is empty without a content base (same-origin /content only)', async () => {
    const config = await loadConfig(undefined)
    expect(config.env).toEqual({ NEXT_PUBLIC_CONTENT_BASE_URL: '' })
  })
})
