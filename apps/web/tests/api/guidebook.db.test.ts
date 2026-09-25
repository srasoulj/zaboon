/** GET /api/guidebooks/:unitId: the unit's Guidebook with resolved audio URLs. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as guidebookRoute from '../../app/api/guidebooks/[unitId]/route'
import { play } from './flows'
import { createHarness, loadCourseDir, type Harness, type TestUser } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const getGuidebook = (user: TestUser | null, unitId: string, query = '') =>
  h.call(guidebookRoute.GET, {
    path: `/api/guidebooks/${encodeURIComponent(unitId)}${query}`,
    params: { unitId },
    user,
  })

const audioRefs = (markdown: string) =>
  [...markdown.matchAll(/<fa\b[^>]*\saudio="([^"]*)"/g)].map((m) => m[1]!)

describe('GET /api/guidebooks/:unitId', () => {
  it('returns the markdown with every <fa audio> ref resolved to a served file', async () => {
    const alice = await h.guest()
    await play(h, alice, { kind: 'practice' }) // makes `fixture` the active course
    const res = await getGuidebook(alice, 'u01-fixture')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({
      courseId: 'fixture',
      contentVersion: 1,
      unitId: 'u01-fixture',
      title: 'Fixture unit',
    })
    expect(res.body.markdown).toContain('سلام، خوبی؟')
    // ZWNJ survives.
    expect(res.body.markdown).toContain('می‌خوام')
    const refs = audioRefs(res.body.markdown)
    expect(refs).toHaveLength(2)
    for (const url of refs) {
      expect(url).toMatch(/^\/content\/fixture\/assets\/audio\/s_u01_000[18]\.[0-9a-f]{10}\.mp3$/)
      expect(existsSync(join(h.contentDir, url.replace(/^\/content\//, '')))).toBe(true)
    }
    expect(res.body.markdown).not.toContain('audio="audio/')
  })

  it('reads ?courseId= like /api/path', async () => {
    const bob = await h.guest() // no enrollment: the default course isn't in this database
    expect((await getGuidebook(bob, 'u01-fixture')).status).toBe(404)
    const res = await getGuidebook(bob, 'u01-fixture', '?courseId=fixture')
    expect(res.status).toBe(200)
    expect(res.body.courseId).toBe('fixture')
    expect((await getGuidebook(bob, 'u01-fixture', '?courseId=Bad%20Id')).status).toBe(400)
  })

  it('answers 404 for an unknown or malformed unit id', async () => {
    const alice = await h.guest()
    await play(h, alice, { kind: 'practice' })
    for (const id of ['u99-nowhere', 'not a unit', '../u01-fixture']) {
      const res = await getGuidebook(alice, id)
      expect(res.status, id).toBe(404)
      expect(res.body).toMatchObject({ error: { code: 'not_found' } })
    }
  })

  it('answers 401 without a token', async () => {
    const res = await getGuidebook(null, 'u01-fixture')
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ error: { code: 'unauthorized' } })
  })

  // Last: publishes a new current version of the fixture course.
  it('answers 404 for a unit without a guidebook', async () => {
    const course = loadCourseDir('fixtures')
    await h.publish({
      ...course,
      units: course.units.map(({ guidebook: _dropped, ...u }) => u),
    })
    const alice = await h.guest()
    await play(h, alice, { kind: 'practice' })
    const res = await getGuidebook(alice, 'u01-fixture')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: { code: 'not_found' } })
  })
})
