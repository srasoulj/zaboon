import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@zaboon/db/testing'
import { loadCourse, type LoadedCourse } from './load'
import { publishLocal } from './publish'
import { repoRoot } from './paths'

const fixtures = loadCourse(join(repoRoot(), 'content/fixtures'))
let tdb: TestDatabase
let out: string

beforeAll(async () => {
  tdb = await createTestDatabase()
  out = mkdtempSync(join(tmpdir(), 'zaboon-publish-'))
})
afterAll(async () => {
  await tdb.drop()
  rmSync(out, { recursive: true, force: true })
})

const publish = (course: LoadedCourse, makeCurrent = true) =>
  publishLocal({ course, outRoot: out, databaseUrl: tdb.appUrl, allowDrafts: false, makeCurrent })

async function rows() {
  const sql = postgres(tdb.adminUrl, { max: 1, onnotice: () => {} })
  try {
    return await sql<
      { version: number; is_current: boolean; bundle_path: string; includes_drafts: boolean }[]
    >`
      SELECT version, is_current, bundle_path, includes_drafts FROM content_versions WHERE course_id = 'fixture' ORDER BY version`
  } finally {
    await sql.end()
  }
}

describe('publish --local', () => {
  it('publishes v1 once, even when three publishes race', async () => {
    const results = await Promise.all([publish(fixtures), publish(fixtures), publish(fixtures)])
    expect(results.filter((r) => r.changed)).toHaveLength(1)
    expect(results.every((r) => r.version === 1 && r.bundlePath === 'fixture/v1')).toBe(true)
    expect(await rows()).toEqual([
      { version: 1, is_current: true, bundle_path: 'fixture/v1', includes_drafts: false },
    ])
    expect(existsSync(join(out, 'fixture/v1/manifest.json'))).toBe(true)
  })

  it('is a no-op when the content is unchanged', async () => {
    expect(await publish(fixtures)).toMatchObject({ version: 1, changed: false })
    expect(await rows()).toHaveLength(1)
  })

  it('publishes changed content as the next version and moves the current pointer', async () => {
    const changed = structuredClone(fixtures)
    changed.sentences[0]!.en = ['Hello, how are you?', 'Hi, how are you?']
    expect(await publish(changed)).toMatchObject({ version: 2, changed: true })
    expect((await rows()).map((r) => [r.version, r.is_current])).toEqual([
      [1, false],
      [2, true],
    ])
  })

  it('can register a version without making it current', async () => {
    const changed = structuredClone(fixtures)
    changed.sentences[0]!.en = 'Hello, how are you?'
    expect(await publish(changed, false)).toMatchObject({ version: 3, changed: true })
    expect((await rows()).map((r) => [r.version, r.is_current])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ])
  })
})
