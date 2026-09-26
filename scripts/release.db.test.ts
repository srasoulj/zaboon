/**
 * scripts/release.ts against a private database: pending migrations are applied once and
 * recorded like `supabase db push`; changed content is published as the next immutable version and
 * made current; unchanged content publishes nothing; versions already in the bucket (published
 * elsewhere, or half-uploaded by a failed build) are skipped, never overwritten.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../packages/db/src/testing'
import { loadCourse, type LoadedCourse } from '../tools/content-cli/src/load'
import { IMMUTABLE_CACHE, MemoryUploader } from '../tools/content-cli/src/storage'
import { loadMigrations } from './migrations'
import { release, type ReleaseCourse } from './release'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.ZABOON_DB_PORT ?? 54322)
const FIXTURES: ReleaseCourse = { id: 'fixture', dir: 'content/fixtures', allowDrafts: false }
const NOW = new Date('2026-09-26T12:00:00Z')
const JSON_OPTS = { contentType: 'application/json', cacheControl: IMMUTABLE_CACHE }

let tdb: TestDatabase
let admin: postgres.Sql
let env: NodeJS.ProcessEnv
const lines: string[] = []
const log = (line: string) => lines.push(line)

/** [version, isCurrent] of the fixture course, newest first. */
async function versions(): Promise<[number, boolean][]> {
  const rows = await admin`SELECT version, is_current FROM public.content_versions
                            WHERE course_id = 'fixture' ORDER BY version DESC`
  return rows.map((r) => [r.version as number, r.is_current as boolean])
}

function changedFixtures(en: string): LoadedCourse {
  const course = structuredClone(loadCourse(join(ROOT, 'content/fixtures')))
  course.sentences[0]!.en = en
  return course
}

beforeAll(async () => {
  tdb = await createTestDatabase()
  admin = postgres(tdb.adminUrl, { max: 1, onnotice: () => {} })
  // The migration role, as on Supabase: `postgres`, the table owner (trust auth locally).
  env = {
    DATABASE_URL_MIGRATE: `postgres://postgres@127.0.0.1:${PORT}/${tdb.name}`,
    VERCEL_ENV: 'production',
  }
})
afterAll(async () => {
  await admin.end()
  await tdb.drop()
})

describe('release: when it runs', () => {
  it('skips without a migration database off production, and refuses on production', async () => {
    const preview = await release({ env: { VERCEL_ENV: 'preview' }, log })
    expect(preview.skipped).toMatch(/DATABASE_URL_MIGRATE is not set \(preview\)/)
    expect(preview).toMatchObject({ migrations: [], content: [] })
    const laptop = await release({ env: {}, log })
    expect(laptop.skipped).toMatch(/not on Vercel/)
    await expect(release({ env: { VERCEL_ENV: 'production' }, log })).rejects.toThrow(
      /DATABASE_URL_MIGRATE is not set/,
    )
  })
})

describe('release: migrations', () => {
  it('applies a pending migration once, recorded like the CLI, and skips the recorded ones', async () => {
    const real = loadMigrations(join(ROOT, 'supabase', 'migrations'))
    expect(real.length).toBeGreaterThan(0)
    const extra = {
      version: '20991231000000',
      name: 'release_test',
      sql: 'CREATE TABLE public.release_test (id int PRIMARY KEY);\nALTER TABLE public.release_test ENABLE ROW LEVEL SECURITY;\n',
    }
    const first = await release({ env, migrations: [...real, extra], courses: [], log })
    expect(first.skipped).toBeUndefined()
    // The template database already carries every real migration.
    expect(first.migrations).toEqual(['20991231000000_release_test'])
    const [row] = await admin`SELECT name, statements FROM supabase_migrations.schema_migrations
                              WHERE version = '20991231000000'`
    expect(row).toEqual({ name: 'release_test', statements: [extra.sql] })
    expect((await admin`SELECT to_regclass('public.release_test') AS t`)[0]!.t).toBe('release_test')
    expect(lines).toContain('[release] applied 20991231000000_release_test')

    const again = await release({ env, migrations: [...real, extra], courses: [], log })
    expect(again.migrations).toEqual([])
  })
})

describe('release: content', () => {
  const uploader = new MemoryUploader()

  it('publishes the first version and makes it current; unchanged content publishes nothing', async () => {
    const first = await release({
      env,
      migrations: [],
      courses: [FIXTURES],
      uploader,
      now: NOW,
      log,
    })
    expect(first.content).toEqual([{ courseId: 'fixture', version: 1, changed: true }])
    expect(uploader.log.at(-1)).toBe('fixture/v1/manifest.json')
    expect(await versions()).toEqual([[1, true]])
    const [row] = await admin`SELECT bundle_path, includes_drafts FROM public.content_versions
                              WHERE course_id = 'fixture' AND version = 1`
    expect(row).toEqual({ bundle_path: 'fixture/v1', includes_drafts: false })

    const uploads = uploader.log.length
    const same = await release({
      env,
      migrations: [],
      courses: [FIXTURES],
      uploader,
      now: NOW,
      log,
    })
    expect(same.content).toEqual([{ courseId: 'fixture', version: 1, changed: false }])
    expect(uploader.log.length).toBe(uploads)
    expect(await versions()).toEqual([[1, true]])
    expect(lines).toContain('[release] content: fixture unchanged (current is v1)')
  })

  it('publishes changed content as the next version and moves the pointer', async () => {
    const r = await release({
      env,
      migrations: [],
      courses: [FIXTURES],
      uploader,
      loadCourse: () => changedFixtures('Hi there'),
      now: NOW,
      log,
    })
    expect(r.content).toEqual([{ courseId: 'fixture', version: 2, changed: true }])
    expect(await versions()).toEqual([
      [2, true],
      [1, false],
    ])
    // Hashed assets are shared between versions, so v2 uploaded only its own files.
    expect(uploader.log.filter((p) => p.startsWith('fixture/v2/')).length).toBeGreaterThan(0)
    expect(uploader.log.filter((p) => p.startsWith('fixture/assets/')).length).toBe(
      uploader.log
        .slice(0, uploader.log.indexOf('fixture/v1/manifest.json'))
        .filter((p) => p.startsWith('fixture/assets/')).length,
    )
  })

  it('skips a half-uploaded and a foreign version instead of touching them', async () => {
    await uploader.upload('fixture/v3/build-info.json', Buffer.from('{}'), JSON_OPTS)
    await uploader.upload('fixture/v4/manifest.json', Buffer.from('{}'), JSON_OPTS)
    const r = await release({
      env,
      migrations: [],
      courses: [FIXTURES],
      uploader,
      loadCourse: () => changedFixtures('Hello again'),
      now: NOW,
      log,
    })
    expect(r.content).toEqual([{ courseId: 'fixture', version: 5, changed: true }])
    expect(await versions()).toEqual([
      [5, true],
      [2, false],
      [1, false],
    ])
    expect(uploader.objects.get('fixture/v3/build-info.json')!.bytes.toString()).toBe('{}')
    expect(uploader.objects.get('fixture/v4/manifest.json')!.bytes.toString()).toBe('{}')
    expect(lines.some((l) => /fixture\/v3\/.*partial upload.*trying v4/.test(l))).toBe(true)
    expect(lines.some((l) => /fixture\/v4 is already published.*trying v5/.test(l))).toBe(true)
  })

  it('publishes again when the current version is missing from the bucket', async () => {
    const empty = new MemoryUploader()
    const r = await release({
      env,
      migrations: [],
      courses: [FIXTURES],
      uploader: empty,
      loadCourse: () => changedFixtures('Hello again'),
      now: NOW,
      log,
    })
    expect(r.content).toEqual([{ courseId: 'fixture', version: 6, changed: true }])
    expect((await versions())[0]).toEqual([6, true])
    expect(lines.some((l) => /fixture\/v5\/build-info.json is missing/.test(l))).toBe(true)
  })

  it('fails before uploading or registering anything when the content has errors', async () => {
    const broken = changedFixtures('x')
    broken.chats[0]!.answer = 9
    const before = [...uploader.log]
    await expect(
      release({
        env,
        migrations: [],
        courses: [FIXTURES],
        uploader,
        loadCourse: () => broken,
        log,
      }),
    ).rejects.toThrow(/content has errors/)
    expect(uploader.log).toEqual(before)
    expect((await versions())[0]).toEqual([6, true])
  })

  it('refuses a directory that holds a different course', async () => {
    await expect(
      release({
        env,
        migrations: [],
        courses: [{ id: 'fa-en', dir: 'content/fixtures', allowDrafts: false }],
        uploader,
        log,
      }),
    ).rejects.toThrow(/is course "fixture", not "fa-en"/)
  })
})
