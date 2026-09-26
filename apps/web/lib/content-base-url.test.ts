import { describe, expect, it } from 'vitest'
import { contentBaseUrlFromEnv } from './content-base-url'

describe('contentBaseUrlFromEnv', () => {
  it('prefers an explicit CONTENT_BASE_URL', () => {
    expect(
      contentBaseUrlFromEnv({
        CONTENT_BASE_URL: 'https://cdn.example.test/content',
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      }),
    ).toBe('https://cdn.example.test/content')
  })

  it("derives the Supabase project's public content bucket, where the release publishes", () => {
    expect(contentBaseUrlFromEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co/' })).toBe(
      'https://x.supabase.co/storage/v1/object/public/content',
    )
    expect(
      contentBaseUrlFromEnv({
        CONTENT_BASE_URL: '',
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      }),
    ).toBe('https://x.supabase.co/storage/v1/object/public/content')
  })

  it('is empty with neither (same-origin /content, as in local mode)', () => {
    expect(contentBaseUrlFromEnv({})).toBe('')
    expect(contentBaseUrlFromEnv({ CONTENT_BASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: '' })).toBe('')
  })
})
