/**
 * The practice hub on the server: GET /api/practice counts only mistakes the engine can drill and
 * offers listening only when the practice content has audio; the practice mode reaches the session
 * engine only while flags.practiceHub is on.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChallengeRef } from '@zaboon/contracts'
import { generateSession } from '@zaboon/session-engine'
import type * as SessionEngine from '@zaboon/session-engine'
import { createHarness, loadCourseDir, type Harness, type TestUser } from '../api/harness'
import { api, lesson, read, startLesson } from './helpers'

vi.mock('@zaboon/session-engine', async (importOriginal) => {
  const orig = await importOriginal<typeof SessionEngine>()
  return { ...orig, generateSession: vi.fn(orig.generateSession) }
})

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h?.close()
})

const now = '2031-05-07T12:00:00.000Z'
const HUB = { practiceHub: true }

const practice = (u: TestUser) => read(h, api.practice, '/api/practice', u, { now, flags: HUB })
interface ModeCard {
  mode: string
  available: boolean
  count: number | null
}
const mode = (body: { modes: ModeCard[] }, name: string) => body.modes.find((m) => m.mode === name)!

/** A learner of the fixture course with one wrong answer (challenge 0 of u01-s0). */
async function withMistake(): Promise<{ u: TestUser; items: string[] }> {
  const u = await h.guest()
  await lesson(h, u, { now, wrong: [0] })
  const rows =
    await h.sql`SELECT item_ref FROM mistakes WHERE user_id = ${u.id} AND resolved_at IS NULL`
  const items = rows.map((r) => String(r.item_ref))
  expect(items.length).toBeGreaterThan(0)
  return { u, items }
}

describe('GET /api/practice', () => {
  it('counts only drillable mistakes (not letters, not unknown items)', async () => {
    const { u, items } = await withMistake()
    await h.sql`INSERT INTO mistakes (user_id, item_ref, last_wrong_at) VALUES
      (${u.id}, 'letter:l_be', ${now}), (${u.id}, 'lexeme:lx_not_in_this_course', ${now})`
    const res = await practice(u)
    expect(res.status).toBe(200)
    expect(mode(res.body, 'mistakes')).toEqual({
      mode: 'mistakes',
      available: true,
      count: items.length,
    })
    // Only undrillable mistakes: not available.
    const v = await h.guest()
    await lesson(h, v, { now })
    await h.sql`INSERT INTO mistakes (user_id, item_ref, last_wrong_at) VALUES (${v.id}, 'letter:l_be', ${now})`
    expect(mode((await practice(v)).body, 'mistakes')).toEqual({
      mode: 'mistakes',
      available: false,
      count: 0,
    })
  })

  it('offers listening only when the practice content has audio', async () => {
    const u = await h.guest()
    await lesson(h, u, { now })
    expect(mode((await practice(u)).body, 'listening').available).toBe(true)
    // A new version of the fixture course without any audio.
    const course = loadCourseDir('fixtures')
    const silent = {
      ...course,
      lexemes: course.lexemes.map(({ audio: _a, ...l }) => l),
      sentences: course.sentences.map(({ audio: _a, ...s }) => s),
      // Pinned listening challenges need audio: drop them too.
      units: course.units.map((unit) => ({
        ...unit,
        levels: unit.levels.map((l) =>
          l.spec
            ? {
                ...l,
                spec: {
                  ...l.spec,
                  pinned: l.spec.pinned.filter((p) => !p.type.startsWith('listen_')),
                },
              }
            : l,
        ),
      })),
    } as typeof course
    await h.publish(silent)
    try {
      expect(mode((await practice(u)).body, 'listening').available).toBe(false)
    } finally {
      await h.publish('fixtures')
    }
  })
})

describe('practice modes reach the session engine', () => {
  const lastInput = () => vi.mocked(generateSession).mock.calls.at(-1)![0]
  const refsOf = async (sessionId: string) =>
    (await h.sql`SELECT challenge_refs FROM sessions WHERE id = ${sessionId}`)[0]!
      .challenge_refs as ChallengeRef[]

  it('with the hub on, a mistakes session drills the mistaken items', async () => {
    const { u, items } = await withMistake()
    const ids = items.map((r) => r.slice(r.indexOf(':') + 1))
    const s = await startLesson(h, u, { now, kind: 'practice', mode: 'mistakes', flags: HUB })
    expect(lastInput().practiceMode).toBe('mistakes')
    const refs = await refsOf(s.sessionId)
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.some((r) => r.items.some((id) => ids.includes(id)))).toBe(true)
  })

  it('with the hub off, the same request builds the MVP practice session', async () => {
    const { u } = await withMistake()
    await startLesson(h, u, {
      now,
      kind: 'practice',
      mode: 'mistakes',
      flags: { practiceHub: false },
    })
    expect(lastInput()).not.toHaveProperty('practiceMode')
    await startLesson(h, u, { now, kind: 'practice', flags: HUB })
    expect(lastInput()).not.toHaveProperty('practiceMode')
  })
})
