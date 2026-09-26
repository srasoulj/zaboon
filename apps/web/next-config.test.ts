import { afterEach, describe, expect, it, vi } from 'vitest'
import { contentBaseUrlFromEnv } from './lib/content-base-url'

const VARS = ['CONTENT_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'] as const
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))

/** next.config.ts reads the environment when it loads, so each case re-imports it. */
async function loadConfig(env: Partial<Record<(typeof VARS)[number], string>>) {
  vi.resetModules()
  for (const k of VARS) {
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  return (await import('./next.config')).default
}

describe('next.config env', () => {
  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('inlines the server content base for the browser', async () => {
    const config = await loadConfig({
      CONTENT_BASE_URL: 'https://cdn.example.test/storage/v1/object/public/content',
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    })
    expect(config.env).toEqual({
      NEXT_PUBLIC_CONTENT_BASE_URL: 'https://cdn.example.test/storage/v1/object/public/content',
    })
  })

  it("falls back to the Supabase project's content bucket, the same rule as lib/content-base-url.ts", async () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co/' }
    const config = await loadConfig(env)
    expect(config.env).toEqual({
      NEXT_PUBLIC_CONTENT_BASE_URL: 'https://x.supabase.co/storage/v1/object/public/content',
    })
    expect(config.env!.NEXT_PUBLIC_CONTENT_BASE_URL).toBe(contentBaseUrlFromEnv(env))
  })

  it('is empty without either (same-origin /content only)', async () => {
    const config = await loadConfig({})
    expect(config.env).toEqual({ NEXT_PUBLIC_CONTENT_BASE_URL: '' })
    expect(config.env!.NEXT_PUBLIC_CONTENT_BASE_URL).toBe(contentBaseUrlFromEnv({}))
  })
})
