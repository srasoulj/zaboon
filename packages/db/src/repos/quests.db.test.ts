import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { repos, withUser, withUserLock } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { quests } = repos
const at = '2026-09-25T12:00:00.000Z'

let ctx: TestContext
let alice: string
let bob: string

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
  bob = await ctx.newUser()
})
afterAll(() => ctx.close())

describe('quests', () => {
  it('quest_defs are seeded and readable', async () => {
    const defs = await withUser(ctx.h.db, alice, (tx) => quests.listQuestDefs(tx))
    expect(defs.map((d) => d.id)).toContain('xp_20')
    expect(defs.every((d) => /^[a-z0-9_]{1,40}$/.test(d.id))).toBe(true)
  })

  it('saves and reads progress per local date (upsert)', async () => {
    await withUserLock(ctx.h.db, alice, (tx) =>
      quests.saveUserQuests(
        tx,
        alice,
        '2026-09-25',
        [
          { questId: 'xp_20', progress: 5, claimed: false },
          { questId: 'lessons_1', progress: 1, claimed: true },
        ],
        at,
      ),
    )
    await withUserLock(ctx.h.db, alice, (tx) =>
      quests.saveUserQuests(
        tx,
        alice,
        '2026-09-25',
        [{ questId: 'xp_20', progress: 20, claimed: true }],
        at,
      ),
    )
    expect(
      await withUser(ctx.h.db, alice, (tx) => quests.listUserQuests(tx, alice, '2026-09-25')),
    ).toEqual([
      { questId: 'lessons_1', progress: 1, claimed: true },
      { questId: 'xp_20', progress: 20, claimed: true },
    ])
    expect(
      await withUser(ctx.h.db, alice, (tx) => quests.listUserQuests(tx, alice, '2026-09-26')),
    ).toEqual([])
  })

  it("another user's rows are invisible", async () => {
    expect(
      await withUser(ctx.h.db, bob, (tx) => quests.listUserQuests(tx, alice, '2026-09-25')),
    ).toEqual([])
  })

  it('refuses an unknown quest id (FK to quest_defs)', async () => {
    await expect(
      withUserLock(ctx.h.db, alice, (tx) =>
        quests.saveUserQuests(
          tx,
          alice,
          '2026-09-25',
          [{ questId: 'nope_1', progress: 1, claimed: false }],
          at,
        ),
      ),
    ).rejects.toThrow()
  })
})
