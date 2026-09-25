import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { DEFAULT_APP_CONFIG, FLAG_DEFAULTS } from '@zaboon/contracts'
import { ScopeError, repos, withSystem, withUser } from '../index'
import { createTestContext, type TestContext } from '../testing'

const { content } = repos

let ctx: TestContext
let alice: string

beforeAll(async () => {
  ctx = await createTestContext()
  alice = await ctx.newUser()
})
afterAll(() => ctx.close())

describe('content_versions', () => {
  it('publishes versions and switches the current one (one per course)', async () => {
    await withSystem(ctx.h.db, async (tx) => {
      await content.publishContentVersion(tx, { courseId: 'fixture', version: 1, bundlePath: '/v1/fixture' })
      await content.publishContentVersion(tx, { courseId: 'fixture', version: 2, bundlePath: '/v2/fixture', minAppVersion: '0.2.0' })
      await content.publishContentVersion(tx, { courseId: 'fixture', version: 2, bundlePath: '/ignored' })
      await content.publishContentVersion(tx, { courseId: 'fa-en', version: 1, bundlePath: '/v1/fa-en' })
    })
    expect(await content.getCurrentContentVersion(ctx.h.db, 'fixture')).toBeNull()

    expect(await withSystem(ctx.h.db, (tx) => content.setCurrentContentVersion(tx, 'fixture', 1))).toBe(true)
    expect(await withSystem(ctx.h.db, (tx) => content.setCurrentContentVersion(tx, 'fa-en', 1))).toBe(true)
    expect(await withSystem(ctx.h.db, (tx) => content.setCurrentContentVersion(tx, 'fixture', 2))).toBe(true)
    expect(await withSystem(ctx.h.db, (tx) => content.setCurrentContentVersion(tx, 'fixture', 9))).toBe(false)

    const cur = await withUser(ctx.h.db, alice, (tx) => content.getCurrentContentVersion(tx, 'fixture'))
    expect(cur).toMatchObject({ version: 2, bundlePath: '/v2/fixture', minAppVersion: '0.2.0', isCurrent: true })
    expect((await content.getCurrentContentVersion(ctx.h.db, 'fa-en'))?.version).toBe(1)
    expect((await content.listContentVersions(ctx.h.db, 'fixture')).map((v) => [v.version, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ])
    expect(await content.getContentVersion(ctx.h.db, 'fixture', 1)).toMatchObject({ bundlePath: '/v1/fixture' })
  })

  it('writes require system scope (repository check and RLS)', async () => {
    await expect(
      withUser(ctx.h.db, alice, (tx) => content.publishContentVersion(tx, { courseId: 'x', version: 1, bundlePath: '/x' })),
    ).rejects.toBeInstanceOf(ScopeError)
    await expect(
      withUser(ctx.h.db, alice, (tx) =>
        tx.execute(sql`INSERT INTO public.content_versions (course_id, version, bundle_path) VALUES ('x', 1, '/x')`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
    await expect(withUser(ctx.h.db, alice, (tx) => content.setAppConfig(tx, 'hearts', {}))).rejects.toBeInstanceOf(ScopeError)
  })
})

describe('app_config', () => {
  it('returns the defaults when there are no rows', async () => {
    const loaded = await content.loadAppConfig(ctx.h.db)
    expect(loaded).toEqual({ config: DEFAULT_APP_CONFIG, flags: { ...FLAG_DEFAULTS }, invalidKeys: [] })
  })

  it('deep-merges valid overrides and ignores invalid ones', async () => {
    await withSystem(ctx.h.db, async (tx) => {
      await content.setAppConfig(tx, 'hearts', { max: 7 })
      await content.setAppConfig(tx, 'flags', { leagues: true })
      await content.setAppConfig(tx, 'streak', { maxFreezes: -1 })
      await content.setAppConfig(tx, 'noSuchKey', 1)
    })
    const loaded = await withUser(ctx.h.db, alice, (tx) => content.loadAppConfig(tx))
    expect(loaded.config.hearts).toEqual({ ...DEFAULT_APP_CONFIG.hearts, max: 7 })
    expect(loaded.config.streak).toEqual(DEFAULT_APP_CONFIG.streak)
    expect(loaded.flags).toEqual({ ...FLAG_DEFAULTS, leagues: true })
    expect(loaded.invalidKeys).toEqual(['noSuchKey', 'streak'])
    expect(await content.getAppConfigRows(ctx.h.db)).toMatchObject({ hearts: { max: 7 } })

    await withSystem(ctx.h.db, (tx) => content.setAppConfig(tx, 'hearts', { max: 6 }))
    expect((await content.loadAppConfig(ctx.h.db)).config.hearts.max).toBe(6)
  })
})
