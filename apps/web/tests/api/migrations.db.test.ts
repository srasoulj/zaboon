/**
 * Content pickup (ARCHITECTURE §10.4): a new content version renames levels; enrollments at the old
 * version are migrated lazily with the manifest's pathMigrations.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetContentCache } from '../../lib/server/content'
import { api, finish, get, play, start, type StartedSession } from './flows'
import { createHarness, loadCourseDir, type Harness, type TestUser } from './harness'

let h: Harness
let alice: TestUser
let guest: TestUser
let pending: StartedSession

const RENAMES = { 'u01-s0': 'u01-s0b', 'u01-l1': 'u01-l1b' } as const

beforeAll(async () => {
  h = await createHarness()
  // At v1: alice finishes the first level and starts the next one; a guest finishes the first.
  alice = await h.guest()
  await play(h, alice)
  pending = await start(h, alice, { levelId: 'u01-l1' })
  guest = await h.guest()
  await play(h, guest)

  // v2 renames two levels and ships the migration.
  const course = structuredClone(loadCourseDir('fixtures'))
  for (const level of course.units[0]!.levels) {
    const to = RENAMES[level.id as keyof typeof RENAMES]
    if (to) level.id = to
  }
  const v2 = await h.publish(course)
  expect(v2.version).toBe(2)
  const file = join(h.contentDir, v2.bundlePath, 'manifest.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  manifest.pathMigrations = [{ from: 1, to: 2, levels: RENAMES }]
  writeFileSync(file, JSON.stringify(manifest))
  resetContentCache()
})
afterAll(async () => {
  await h?.close()
})

const states = (body: { sections: { units: { levels: { id: string; state: string }[] }[] }[] }) =>
  Object.fromEntries(body.sections.flatMap((s) => s.units.flatMap((u) => u.levels)).map((l) => [l.id, l.state]))

describe('lazy path migrations', () => {
  it('moves progress to the renamed levels when the learner opens the path', async () => {
    const res = await get(h, api.path, '/api/path', alice)
    expect(res.body.contentVersion).toBe(2)
    expect(states(res.body)).toMatchObject({ 'u01-s0b': 'completed', 'u01-l1b': 'current' })
    const [e] = await h.sql`SELECT content_version, current_level_id FROM enrollments WHERE user_id = ${alice.id}`
    expect(e).toMatchObject({ content_version: 2, current_level_id: 'u01-l1b' })
    // Idempotent: opening the path again changes nothing.
    expect(states((await get(h, api.path, '/api/path', alice)).body)['u01-s0b']).toBe('completed')
  })

  it('counts a session started at v1 for the renamed level', async () => {
    const result = await finish(h, alice, pending)
    expect(result).toMatchObject({ contentVersion: 1, level: { levelId: 'u01-l1b', completed: true } })
    expect(states((await get(h, api.path, '/api/path', alice)).body)).toMatchObject({
      'u01-l1b': 'completed',
      'u01-l2': 'current',
    })
  })

  it('refuses the old level ids for new sessions', async () => {
    const r = await h.call(api.createSession, {
      path: '/api/sessions',
      user: alice,
      body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'UTC' },
    })
    expect(r.status).toBe(404)
  })

  it('brings both learners to the current version before merging a guest into a member', async () => {
    const member = await h.member()
    // Enrolled at v2 without finishing a level: u01-s0b can only come from the guest's v1 progress.
    await play(h, member, { kind: 'practice' })
    expect(states((await get(h, api.path, '/api/path', member)).body)['u01-s0b']).toBe('current')
    const merged = await h.call(api.merge, {
      path: '/api/account/merge',
      user: member,
      body: { guestToken: guest.token },
    })
    expect(merged.status).toBe(200)
    expect(merged.body.merged).toBe(true)
    const path = await get(h, api.path, '/api/path', member)
    expect(states(path.body)).toMatchObject({ 'u01-s0b': 'completed', 'u01-l1b': 'current' })
    const rows = await h.sql`
      SELECT level_id FROM level_progress WHERE user_id = ${member.id} AND completed_at IS NOT NULL ORDER BY level_id`
    expect(rows.map((r) => r.level_id)).toContain('u01-s0b')
  })
})
