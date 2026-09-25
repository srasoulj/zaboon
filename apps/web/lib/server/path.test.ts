import { describe, expect, it } from 'vitest'
import type { Manifest } from '@zaboon/content-schema'
import { currentOf, levelStates, migrateLevelId, migrationSteps } from './path'

const done = (levelId: string, extra: { legendary?: boolean; lessonsDone?: number } = {}) =>
  [
    levelId,
    {
      courseId: 'c',
      levelId,
      lessonsDone: extra.lessonsDone ?? 1,
      legendary: extra.legendary ?? false,
      completedAt: '2031-01-01T00:00:00.000Z',
      updatedAt: '2031-01-01T00:00:00.000Z',
    },
  ] as const

const lvl = (id: string, kind = 'lesson', lessonsTotal = 1) => ({ id, kind, lessonsTotal })

describe('levelStates', () => {
  it('makes the first unfinished playable level current and locks the rest', () => {
    const s = levelStates([lvl('a'), lvl('b'), lvl('c')], new Map([done('a')]))
    expect([...s.values()].map((x) => x.state)).toEqual(['completed', 'current', 'locked'])
    expect(currentOf(s)).toBe('b')
  })

  it('keeps completed levels after the current one completed, and shows legendary', () => {
    const s = levelStates([lvl('a'), lvl('b'), lvl('c')], new Map([done('a', { legendary: true }), done('c')]))
    expect([...s.values()].map((x) => x.state)).toEqual(['legendary', 'current', 'completed'])
  })

  it('never blocks the path on levels without an MVP session (chest, story)', () => {
    const s = levelStates([lvl('a'), lvl('chest', 'chest'), lvl('b'), lvl('story', 'story')], new Map([done('a')]))
    expect([...s.values()].map((x) => x.state)).toEqual(['completed', 'available', 'current', 'locked'])
  })

  it('reports partial progress and caps lessonsDone at the total', () => {
    const partial = [
      'a',
      { ...done('a')[1], completedAt: null, lessonsDone: 2 },
    ] as const
    const s = levelStates([lvl('a', 'lesson', 4)], new Map([partial]))
    expect(s.get('a')).toEqual({ state: 'current', lessonsDone: 2 })
    expect(levelStates([lvl('x', 'lesson', 1)], new Map([done('x', { lessonsDone: 9 })])).get('x')).toEqual({
      state: 'completed',
      lessonsDone: 1,
    })
  })

  it('has no current level once everything is done', () => {
    expect(currentOf(levelStates([lvl('a')], new Map([done('a')])))).toBeNull()
  })
})

describe('path migrations', () => {
  const manifest = {
    pathMigrations: [
      { from: 1, to: 2, levels: { a: 'a2', gone: null } },
      { from: 3, to: 5, levels: { a2: 'a5', b: 'b5' } },
    ],
  } as unknown as Manifest

  it('chains the steps between two versions, skipping versions without a migration', () => {
    expect(migrationSteps(manifest, 1, 5).map((m) => `${m.from}->${m.to}`)).toEqual(['1->2', '3->5'])
    expect(migrationSteps(manifest, 2, 5).map((m) => `${m.from}->${m.to}`)).toEqual(['3->5'])
    expect(migrationSteps(manifest, 1, 4).map((m) => `${m.from}->${m.to}`)).toEqual(['1->2'])
    expect(migrationSteps(manifest, 5, 5)).toEqual([])
  })

  it('maps level ids through every step; removed levels map to null', () => {
    const steps = migrationSteps(manifest, 1, 5)
    expect(migrateLevelId(steps, 'a')).toBe('a5')
    expect(migrateLevelId(steps, 'b')).toBe('b5')
    expect(migrateLevelId(steps, 'gone')).toBeNull()
    expect(migrateLevelId(steps, 'kept')).toBe('kept')
  })
})
