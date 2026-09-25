/** GET /api/path, /api/letters, /api/words and /api/home. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, get, play } from './flows'
import { createHarness, type Harness } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

type PathBody = {
  courseId: string
  contentVersion: number
  sections: {
    units: { levels: { id: string; state: string; lessonsDone: number; lessonsTotal: number }[] }[]
  }[]
}
const levelsOf = (body: PathBody) =>
  Object.fromEntries(
    body.sections.flatMap((s) => s.units.flatMap((u) => u.levels)).map((l) => [l.id, l.state]),
  )

describe('GET /api/path', () => {
  it('shows the first level current and everything after it locked for a new learner', async () => {
    const alice = await h.guest()
    await play(h, alice, { kind: 'practice' }) // enrolls in the fixture course without finishing a level
    const res = await get(h, api.path, '/api/path', alice)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ courseId: 'fixture', contentVersion: 1 })
    expect(levelsOf(res.body)).toEqual({
      'u01-s0': 'current',
      'u01-l1': 'locked',
      'u01-l2': 'locked',
      'u01-p1': 'locked',
      'u01-r1': 'locked',
    })
    expect(res.body.sections[0].units[0]).toMatchObject({
      id: 'u01-fixture',
      color: 'firouzeh',
      hasGuidebook: true,
    })
  })

  it('moves "current" along as levels are completed; completed levels stay completed', async () => {
    const alice = await h.guest()
    await play(h, alice)
    await play(h, alice, { levelId: 'u01-l1' })
    const res = await get(h, api.path, '/api/path', alice)
    expect(levelsOf(res.body)).toMatchObject({
      'u01-s0': 'completed',
      'u01-l1': 'completed',
      'u01-l2': 'current',
      'u01-p1': 'locked',
    })
    const level = res.body.sections[0].units[0].levels[0]
    expect(level).toMatchObject({ lessonsDone: 1, lessonsTotal: 1 })
    // Replaying a completed level keeps it completed.
    await play(h, alice)
    expect(levelsOf((await get(h, api.path, '/api/path', alice)).body)['u01-s0']).toBe('completed')
  })

  it('shows legendary levels', async () => {
    const alice = await h.guest()
    await play(h, alice)
    await h.sql`UPDATE level_progress SET legendary = true WHERE user_id = ${alice.id} AND level_id = 'u01-s0'`
    expect(levelsOf((await get(h, api.path, '/api/path', alice)).body)['u01-s0']).toBe('legendary')
  })

  it('reads the default course (and ?courseId=) and validates the parameter', async () => {
    const alice = await h.guest()
    // A learner with no enrollment reads the default course, which this database doesn't have.
    expect((await get(h, api.path, '/api/path', alice)).status).toBe(404)
    const fixture = await get(h, api.path, '/api/path?courseId=fixture', alice)
    expect(fixture.status).toBe(200)
    expect(levelsOf(fixture.body)['u01-s0']).toBe('current')
    expect((await get(h, api.path, '/api/path?courseId=Bad%20Id', alice)).status).toBe(400)
  })

  it("never shows another learner's progress", async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    await play(h, alice)
    await play(h, bob, { kind: 'practice' })
    expect(levelsOf((await get(h, api.path, '/api/path', bob)).body)['u01-s0']).toBe('current')
  })
})

describe('GET /api/letters', () => {
  it('reports letter strength from FSRS memory and the letter lessons', async () => {
    const alice = await h.guest()
    const before = await get(h, api.letters, '/api/letters?courseId=fixture', alice)
    expect(before.status).toBe(200)
    expect(before.body.letters).toHaveLength(10)
    expect(
      before.body.letters.every(
        (l: { strength: number; introduced: boolean }) => l.strength === 0 && !l.introduced,
      ),
    ).toBe(true)
    expect(before.body.lessons.map((l: { state: string }) => l.state)).toEqual([
      'current',
      'locked',
    ])
    // Tap-to-hear: letter audio refs resolve to hashed URLs under the published version.
    const alef = before.body.letters.find((l: { id: string }) => l.id === 'l_alef')
    expect(alef.audio).toMatch(/^\/content\/.+\/l_alef\.[0-9a-f]+\.mp3$/)

    await play(h, alice, { kind: 'letters' })
    const after = await get(h, api.letters, '/api/letters', alice)
    const introduced = after.body.letters.filter((l: { introduced: boolean }) => l.introduced)
    expect(introduced.length).toBeGreaterThan(0)
    expect(introduced.every((l: { strength: number }) => l.strength === 4)).toBe(true) // just reviewed
    expect(after.body.lessons).toEqual([
      expect.objectContaining({ id: 'u01-letters-1', state: 'completed' }),
      expect.objectContaining({ id: 'u01-letters-2', state: 'current' }),
    ])
    // Strength fades as retrievability drops.
    const later = await get(
      h,
      api.letters,
      '/api/letters',
      alice,
      new Date(Date.now() + 400 * 86_400_000),
    )
    const faded = later.body.letters.filter((l: { introduced: boolean }) => l.introduced)
    expect(faded.every((l: { strength: number }) => l.strength >= 1 && l.strength < 4)).toBe(true)
  })
})

describe('GET /api/words', () => {
  it("lists the learner's words with strength and due date, and nobody else's", async () => {
    const alice = await h.guest()
    const bob = await h.guest()
    expect((await get(h, api.words, '/api/words?courseId=fixture', alice)).body).toEqual({
      words: [],
    })
    await play(h, alice)
    const res = await get(h, api.words, '/api/words', alice)
    const salam = res.body.words.find((w: { lexemeId: string }) => w.lexemeId === 'lx_salam')
    expect(salam).toMatchObject({ fa: 'سلام', strength: 4 })
    expect(salam.audio).toMatch(/^\/content\/.+\/lx_salam\.[0-9a-f]+\.mp3$/)
    expect(typeof salam.dueAt).toBe('string')
    expect(salam.gloss.length).toBeGreaterThan(0)
    expect((await get(h, api.words, '/api/words?courseId=fixture', bob)).body).toEqual({
      words: [],
    })
  })
})

describe('GET /api/home', () => {
  it('uses the most recently used enrollment as the active course', async () => {
    const alice = await h.guest()
    await play(h, alice)
    const home = await get(h, api.home, '/api/home', alice)
    expect(home.body.course).toMatchObject({
      id: 'fixture',
      contentVersion: 1,
      currentLevelId: 'u01-l1',
    })
  })
})
