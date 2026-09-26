import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FsrsCard } from '@zaboon/contracts'
import { repos, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { memory, learning } = repos

let ctx: TestContext
let alice: string
let bob: string

const card = (overrides: Partial<FsrsCard> = {}): FsrsCard => ({
  due: '2026-09-26T10:00:00.000Z',
  stability: 2.5,
  difficulty: 5.1,
  elapsedDays: 0,
  scheduledDays: 1,
  learningSteps: 1,
  reps: 1,
  lapses: 0,
  state: 1,
  lastReview: '2026-09-25T10:00:00.000Z',
  ...overrides,
})

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser()
})
afterAll(() => ctx.close())

describe('lexeme and letter memory', () => {
  it('round-trips FSRS cards exactly', async () => {
    const c = card({ stability: 0.123456789, lastReview: null, state: 0 })
    await withUserLock(ctx.h.db, alice, (tx) =>
      memory.upsertLexemeCards(tx, alice, [{ id: 'lx_salam', card: c, exposures: 1 }]),
    )
    const [got] = await withUser(ctx.h.db, alice, (tx) =>
      memory.getLexemeCards(tx, alice, ['lx_salam']),
    )
    expect(got).toEqual({ id: 'lx_salam', card: c, exposures: 1 })
  })

  it('updates cards; exposures are kept when omitted and replaced when given', async () => {
    await withUserLock(ctx.h.db, alice, (tx) =>
      memory.upsertLexemeCards(tx, alice, [
        { id: 'lx_salam', card: card({ reps: 2, stability: 4 }) },
      ]),
    )
    let [got] = await withUser(ctx.h.db, alice, (tx) =>
      memory.getLexemeCards(tx, alice, ['lx_salam']),
    )
    expect(got).toMatchObject({ exposures: 1, card: { reps: 2, stability: 4 } })
    await withUserLock(ctx.h.db, alice, (tx) =>
      memory.upsertLexemeCards(tx, alice, [
        { id: 'lx_salam', card: card({ reps: 3 }), exposures: 4 },
      ]),
    )
    ;[got] = await withUser(ctx.h.db, alice, (tx) => memory.getLexemeCards(tx, alice, ['lx_salam']))
    expect(got).toMatchObject({ exposures: 4, card: { reps: 3 } })
  })

  it('lists due cards, most overdue first', async () => {
    await withUserLock(ctx.h.db, alice, (tx) =>
      memory.upsertLexemeCards(tx, alice, [
        { id: 'lx_a', card: card({ due: '2026-09-20T00:00:00.000Z' }) },
        { id: 'lx_b', card: card({ due: '2026-09-10T00:00:00.000Z' }) },
        { id: 'lx_c', card: card({ due: '2026-10-10T00:00:00.000Z' }) },
      ]),
    )
    const due = await withUser(ctx.h.db, alice, (tx) =>
      memory.listDueLexemes(tx, alice, '2026-09-25T00:00:00.000Z'),
    )
    expect(due.map((d) => d.id)).toEqual(['lx_b', 'lx_a'])
    const all = await withUser(ctx.h.db, alice, (tx) => memory.getLexemeCards(tx, alice))
    expect(all.map((d) => d.id)).toEqual(['lx_a', 'lx_b', 'lx_c', 'lx_salam'])
    expect(await withUser(ctx.h.db, alice, (tx) => memory.getLexemeCards(tx, alice, []))).toEqual(
      [],
    )
  })

  it('stores letter cards separately', async () => {
    await withUserLock(ctx.h.db, alice, (tx) =>
      memory.upsertLetterCards(tx, alice, [
        { id: 'l_be', card: card({ due: '2026-09-01T00:00:00.000Z' }), exposures: 2 },
        { id: 'l_pe', card: card() },
      ]),
    )
    const letters = await withUser(ctx.h.db, alice, (tx) => memory.getLetterCards(tx, alice))
    expect(letters.map((l) => [l.id, l.exposures])).toEqual([
      ['l_be', 2],
      ['l_pe', 0],
    ])
    const due = await withUser(ctx.h.db, alice, (tx) =>
      memory.listDueLetters(tx, alice, '2026-09-25T00:00:00.000Z'),
    )
    expect(due.map((l) => l.id)).toEqual(['l_be'])
    expect(
      await withUser(ctx.h.db, alice, (tx) => memory.getLetterCards(tx, alice, ['l_pe'])),
    ).toHaveLength(1)
  })

  it('accepts duplicate ids in one upsert (last entry wins) without aborting the transaction', async () => {
    const u = await ctx.newUser()
    const after = await withUserLock(ctx.h.db, u, async (tx) => {
      await memory.upsertLexemeCards(tx, u, [
        { id: 'lx_dup', card: card({ reps: 1 }), exposures: 1 },
        { id: 'lx_other', card: card({ reps: 7 }) },
        { id: 'lx_dup', card: card({ reps: 2 }), exposures: 2 },
      ])
      await memory.upsertLetterCards(tx, u, [
        { id: 'l_dup', card: card({ lapses: 1 }) },
        { id: 'l_dup', card: card({ lapses: 3 }) },
      ])
      // Also with the row already present, mixing entries with and without exposures.
      await memory.upsertLexemeCards(tx, u, [
        { id: 'lx_dup', card: card({ reps: 5 }) },
        { id: 'lx_dup', card: card({ reps: 6 }), exposures: 9 },
      ])
      // The transaction is still usable afterwards.
      return {
        lexemes: await memory.getLexemeCards(tx, u),
        letters: await memory.getLetterCards(tx, u),
      }
    })
    expect(after.lexemes.map((e) => [e.id, e.card.reps, e.exposures])).toEqual([
      ['lx_dup', 6, 9],
      ['lx_other', 7, 0],
    ])
    expect(after.letters.map((e) => [e.id, e.card.lapses])).toEqual([['l_dup', 3]])
  })

  it("never exposes or accepts another user's cards", async () => {
    expect(await withUser(ctx.h.db, bob, (tx) => memory.getLexemeCards(tx, alice))).toEqual([])
    expect(
      await withUser(ctx.h.db, bob, (tx) =>
        memory.listDueLetters(tx, alice, '2030-01-01T00:00:00Z'),
      ),
    ).toEqual([])
    await expect(
      withUserLock(ctx.h.db, bob, (tx) =>
        memory.upsertLexemeCards(tx, alice, [{ id: 'lx_salam', card: card({ reps: 99 }) }]),
      ),
    ).rejects.toThrow()
    const [mine] = await withUser(ctx.h.db, alice, (tx) =>
      memory.getLexemeCards(tx, alice, ['lx_salam']),
    )
    expect(mine!.card.reps).toBe(3)
  })
})

describe('mistakes', () => {
  it('counts, resolves and re-opens mistakes', async () => {
    const u = await ctx.newUser()
    await withUserLock(ctx.h.db, u, (tx) =>
      learning.recordMistakes(
        tx,
        u,
        ['lexeme:lx_a', 'lexeme:lx_a', 'sentence:s_1'],
        '2026-09-25T10:00:00.000Z',
      ),
    )
    await withUserLock(ctx.h.db, u, (tx) =>
      learning.recordMistakes(tx, u, ['lexeme:lx_a'], '2026-09-25T11:00:00.000Z'),
    )
    let open = await withUser(ctx.h.db, u, (tx) => learning.listOpenMistakes(tx, u))
    expect(open.map((m) => [m.itemRef, m.timesWrong, m.lastWrongAt])).toEqual([
      ['lexeme:lx_a', 2, '2026-09-25T11:00:00.000Z'],
      ['sentence:s_1', 1, '2026-09-25T10:00:00.000Z'],
    ])
    expect(
      await withUserLock(ctx.h.db, u, (tx) =>
        learning.resolveMistakes(tx, u, ['lexeme:lx_a'], '2026-09-25T12:00:00Z'),
      ),
    ).toBe(1)
    expect(
      await withUserLock(ctx.h.db, u, (tx) =>
        learning.resolveMistakes(tx, u, ['lexeme:lx_a'], '2026-09-25T12:00:00Z'),
      ),
    ).toBe(0)
    open = await withUser(ctx.h.db, u, (tx) => learning.listOpenMistakes(tx, u))
    expect(open.map((m) => m.itemRef)).toEqual(['sentence:s_1'])
    await withUserLock(ctx.h.db, u, (tx) =>
      learning.recordMistakes(tx, u, ['lexeme:lx_a'], '2026-09-25T13:00:00.000Z'),
    )
    open = await withUser(ctx.h.db, u, (tx) => learning.listOpenMistakes(tx, u))
    expect(open[0]).toMatchObject({ itemRef: 'lexeme:lx_a', timesWrong: 3, resolvedAt: null })
  })

  it('are private to their owner', async () => {
    await withUserLock(ctx.h.db, bob, (tx) =>
      learning.recordMistakes(tx, bob, ['lexeme:lx_b'], '2026-09-25T10:00:00Z'),
    )
    expect(await withUser(ctx.h.db, alice, (tx) => learning.listOpenMistakes(tx, bob))).toEqual([])
    expect(
      await withUserLock(ctx.h.db, alice, (tx) =>
        learning.resolveMistakes(tx, bob, ['lexeme:lx_b'], '2026-09-25T11:00:00Z'),
      ),
    ).toBe(0)
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        learning.recordMistakes(tx, bob, ['lexeme:lx_c'], '2026-09-25T11:00:00Z'),
      ),
    ).rejects.toThrow()
  })
})

describe('level_progress', () => {
  it('counts lessons up to the level total and stamps completion once', async () => {
    const u = await ctx.newUser()
    const rec = (at: string) =>
      withUserLock(ctx.h.db, u, (tx) =>
        learning.recordLessonDone(tx, u, {
          courseId: 'fixture',
          levelId: 'u01-l1',
          lessonsTotal: 2,
          at,
        }),
      )
    expect(await rec('2026-09-25T10:00:00.000Z')).toMatchObject({
      lessonsDone: 1,
      completedAt: null,
    })
    expect(await rec('2026-09-25T11:00:00.000Z')).toMatchObject({
      lessonsDone: 2,
      completedAt: '2026-09-25T11:00:00.000Z',
    })
    expect(await rec('2026-09-25T12:00:00.000Z')).toMatchObject({
      lessonsDone: 2,
      completedAt: '2026-09-25T11:00:00.000Z',
    })

    const single = await withUserLock(ctx.h.db, u, (tx) =>
      learning.recordLessonDone(tx, u, {
        courseId: 'fixture',
        levelId: 'u01-l2',
        lessonsTotal: 1,
        at: '2026-09-25T10:00:00.000Z',
      }),
    )
    expect(single).toMatchObject({ lessonsDone: 1, completedAt: '2026-09-25T10:00:00.000Z' })

    const leg = await withUserLock(ctx.h.db, u, (tx) =>
      learning.setLegendary(tx, u, {
        courseId: 'fixture',
        levelId: 'u01-l1',
        at: '2026-09-26T10:00:00.000Z',
      }),
    )
    expect(leg).toMatchObject({ legendary: true, lessonsDone: 2 })

    const jumped = await withUserLock(ctx.h.db, u, (tx) =>
      learning.setLevelProgress(tx, u, {
        courseId: 'fixture',
        levelId: 'u02-l1',
        lessonsDone: 4,
        completed: true,
        at: '2026-09-26T10:00:00.000Z',
      }),
    )
    expect(jumped).toMatchObject({ lessonsDone: 4, completedAt: '2026-09-26T10:00:00.000Z' })

    const list = await withUser(ctx.h.db, u, (tx) => learning.listLevelProgress(tx, u, 'fixture'))
    expect(list.map((l) => l.levelId)).toEqual(['u01-l1', 'u01-l2', 'u02-l1'])
    expect(await withUser(ctx.h.db, u, (tx) => learning.listLevelProgress(tx, u, 'fa-en'))).toEqual(
      [],
    )
    expect(
      await withUser(ctx.h.db, u, (tx) => learning.getLevelProgress(tx, u, 'fixture', 'u01-l2')),
    ).toMatchObject({ lessonsDone: 1 })
  })

  it('is private to its owner', async () => {
    await withUserLock(ctx.h.db, bob, (tx) =>
      learning.recordLessonDone(tx, bob, {
        courseId: 'fixture',
        levelId: 'u01-l1',
        lessonsTotal: 3,
        at: '2026-09-25T10:00:00Z',
      }),
    )
    expect(
      await withUser(ctx.h.db, alice, (tx) =>
        learning.getLevelProgress(tx, bob, 'fixture', 'u01-l1'),
      ),
    ).toBeNull()
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        learning.recordLessonDone(tx, bob, {
          courseId: 'fixture',
          levelId: 'u01-l1',
          lessonsTotal: 3,
          at: '2026-09-25T10:00:00Z',
        }),
      ),
    ).rejects.toThrow()
    expect(
      await withUser(ctx.h.db, bob, (tx) =>
        learning.getLevelProgress(tx, bob, 'fixture', 'u01-l1'),
      ),
    ).toMatchObject({ lessonsDone: 1 })
  })
})
