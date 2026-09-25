import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Manifest } from '@zaboon/content-schema'
import { loadCourse } from './load'
import { repoRoot } from './paths'
import {
  contentTypeFor,
  contentVersionInsertSql,
  IMMUTABLE_CACHE,
  MemoryUploader,
  publishToStorage,
  SupabaseStorageUploader,
} from './storage'

const fixtures = loadCourse(join(repoRoot(), 'content/fixtures'))

describe('publish --target storage', () => {
  it('uploads assets, then the version, manifest last, immutable, and prints the INSERT', async () => {
    const uploader = new MemoryUploader()
    const r = await publishToStorage({ course: fixtures, uploader, version: 4, allowDrafts: false })
    expect(r.bundlePath).toBe('fixture/v4')
    expect(uploader.log.at(-1)).toBe('fixture/v4/manifest.json')
    const firstVersionFile = uploader.log.findIndex((p) => p.startsWith('fixture/v4/'))
    expect(
      uploader.log.slice(0, firstVersionFile).every((p) => p.startsWith('fixture/assets/')),
    ).toBe(true)
    expect([...uploader.objects.values()].every((o) => o.cacheControl === IMMUTABLE_CACHE)).toBe(
      true,
    )
    expect(uploader.objects.get('fixture/v4/units/u01-fixture.json')!.contentType).toBe(
      'application/json',
    )
    const manifest = Manifest.parse(
      JSON.parse(uploader.objects.get('fixture/v4/manifest.json')!.bytes.toString()),
    )
    expect(manifest).toMatchObject({ version: 4, assetsBase: '../assets/' })
    expect(r.sql).toBe(
      "INSERT INTO public.content_versions (course_id, version, bundle_path, includes_drafts, is_current) VALUES ('fixture', 4, 'fixture/v4', false, false);",
    )
  })

  it('reuses existing content-hashed assets and refuses to overwrite a version', async () => {
    const uploader = new MemoryUploader()
    const first = await publishToStorage({
      course: fixtures,
      uploader,
      version: 1,
      allowDrafts: false,
    })
    const changed = structuredClone(fixtures)
    changed.sentences[0]!.en = 'Hi'
    const second = await publishToStorage({
      course: changed,
      uploader,
      version: 2,
      allowDrafts: false,
    })
    expect(second.skipped.length).toBe(first.uploaded.filter((p) => p.includes('/assets/')).length)
    expect(second.uploaded.every((p) => p.startsWith('fixture/v2/'))).toBe(true)
    await expect(
      publishToStorage({ course: fixtures, uploader, version: 2, allowDrafts: false }),
    ).rejects.toThrow(/immutable/)
  })

  it('stops on a partial version left by a failed run', async () => {
    const uploader = new MemoryUploader()
    await uploader.upload('fixture/v1/letters.json', Buffer.from('{}'), {
      contentType: 'application/json',
      cacheControl: IMMUTABLE_CACHE,
    })
    await expect(
      publishToStorage({ course: fixtures, uploader, version: 1, allowDrafts: false }),
    ).rejects.toThrow(/partial upload/)
  })

  it('never publishes content with errors', async () => {
    const broken = structuredClone(fixtures)
    broken.chats[0]!.answer = 9
    const uploader = new MemoryUploader()
    await expect(
      publishToStorage({ course: broken, uploader, version: 1, allowDrafts: false }),
    ).rejects.toThrow(/content has errors/)
    expect(uploader.objects.size).toBe(0)
  })

  it('escapes SQL literals and maps content types', () => {
    expect(
      contentVersionInsertSql({
        courseId: "o'x",
        version: 1,
        bundlePath: "o'x/v1",
        includesDrafts: true,
      }),
    ).toContain("('o''x', 1, 'o''x/v1', true, false)")
    expect(['a.mp3', 'b.svg', 'c.webp', 'd.riv'].map(contentTypeFor)).toEqual([
      'audio/mpeg',
      'image/svg+xml',
      'image/webp',
      'application/octet-stream',
    ])
  })
})

describe('SupabaseStorageUploader', () => {
  it('reads its URL and key from the environment and refuses without them', () => {
    expect(() => SupabaseStorageUploader.fromEnv({}, 'content')).toThrow(
      /SUPABASE_URL and CONTENT_STORAGE_UPLOAD_KEY/,
    )
    expect(() =>
      SupabaseStorageUploader.fromEnv({ SUPABASE_URL: 'https://x.supabase.co' }, 'content'),
    ).toThrow(/CONTENT_STORAGE_UPLOAD_KEY/)
  })

  it('talks to the Storage REST API without upserts', async () => {
    const seen: { url: string; method: string; headers: Headers; size: number }[] = []
    const uploader = new SupabaseStorageUploader({
      url: 'https://proj.supabase.co/',
      key: 'test-upload',
      bucket: 'content',
      fetch: async (url, init = {}) => {
        const body = init.body as Uint8Array | undefined
        seen.push({
          url,
          method: init.method ?? 'GET',
          headers: new Headers(init.headers),
          size: body?.length ?? 0,
        })
        if (init.method === 'HEAD')
          return new Response(null, { status: url.endsWith('there.json') ? 200 : 400 })
        return new Response('{"Key":"content/x"}', { status: 200 })
      },
    })
    expect(await uploader.exists('fa-en/v1/there.json')).toBe(true)
    expect(await uploader.exists('fa-en/v1/missing.json')).toBe(false)
    await uploader.upload('fa-en/assets/audio/a b.mp3', Buffer.from('abc'), {
      contentType: 'audio/mpeg',
      cacheControl: IMMUTABLE_CACHE,
    })
    const up = seen.at(-1)!
    expect(up.url).toBe(
      'https://proj.supabase.co/storage/v1/object/content/fa-en/assets/audio/a%20b.mp3',
    )
    expect(up.method).toBe('POST')
    expect(up.headers.get('x-upsert')).toBe('false')
    expect(up.headers.get('content-type')).toBe('audio/mpeg')
    expect(up.headers.get('cache-control')).toBe(IMMUTABLE_CACHE)
    expect(up.headers.get('authorization')).toBe('Bearer test-upload')
    expect(up.size).toBe(3)
  })

  it('surfaces upload failures', async () => {
    const uploader = new SupabaseStorageUploader({
      url: 'https://proj.supabase.co',
      key: 'test-upload',
      bucket: 'content',
      fetch: async () => new Response('{"error":"Duplicate"}', { status: 409 }),
    })
    await expect(
      uploader.upload('x.json', Buffer.from('{}'), {
        contentType: 'application/json',
        cacheControl: IMMUTABLE_CACHE,
      }),
    ).rejects.toThrow(/HTTP 409/)
  })
})
