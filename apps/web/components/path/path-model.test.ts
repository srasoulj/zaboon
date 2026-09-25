import { describe, expect, it } from 'vitest'
import {
  ctaLesson,
  lessonLetters,
  lessonStateLabel,
  lettersLessonHref,
} from '../letters/letters-model'
import {
  currentLevelId,
  kindLabel,
  lessonCounter,
  levelProgress,
  levelTitle,
  LOCKED_MESSAGE,
  nodeLabel,
  nodeType,
  playerKind,
  popoverAction,
  unitBrand,
  unitPositions,
} from './path-model'
import { FIXTURE_PATH, level, testPath, TEST_LETTERS } from './test-data'

describe('path mappers', () => {
  it('maps level kinds to kit node types, unknown kinds to the star', () => {
    expect(nodeType('lesson')).toBe('lesson')
    expect(nodeType('unit_review')).toBe('review')
    expect(nodeType('practice')).toBe('practice')
    expect(nodeType('chest')).toBe('chest')
    expect(nodeType('story')).toBe('story')
    expect(nodeType('boss_battle')).toBe('lesson')
    expect(nodeType('toString')).toBe('lesson')
    expect(kindLabel('constructor')).toBe('Lesson')
  })

  it('only lessons, unit reviews and practice start a session', () => {
    expect(playerKind('lesson')).toBe('lesson')
    expect(playerKind('unit_review')).toBe('unit_review')
    expect(playerKind('practice')).toBe('practice')
    expect(playerKind('chest')).toBeNull()
    expect(playerKind('story')).toBeNull()
    expect(playerKind('legendary')).toBeNull()
  })

  it('labels levels', () => {
    expect(levelTitle({ kind: 'unit_review' })).toBe('Unit review')
    expect(levelTitle({ kind: 'lesson', title: '  ' })).toBe('Lesson')
    expect(levelTitle({ kind: 'lesson', title: 'Greetings' })).toBe('Greetings')
    expect(nodeLabel({ kind: 'lesson', title: 'Greetings' })).toBe('Lesson: Greetings')
    expect(nodeLabel({ kind: 'unit_review', title: 'Unit review' })).toBe('Unit review')
    expect(nodeLabel({ kind: 'chest' })).toBe('Reward chest')
  })

  it('computes progress and "Lesson x of y"', () => {
    expect(levelProgress({ lessonsDone: 1, lessonsTotal: 4 })).toBe(0.25)
    expect(levelProgress({ lessonsDone: 9, lessonsTotal: 4 })).toBe(1)
    expect(levelProgress({ lessonsDone: 0, lessonsTotal: 0 })).toBe(0)
    expect(lessonCounter({ lessonsDone: 1, lessonsTotal: 4, state: 'current' })).toBe(
      'Lesson 2 of 4',
    )
    expect(lessonCounter({ lessonsDone: 0, lessonsTotal: 4, state: 'locked' })).toBe(
      'Lesson 1 of 4',
    )
    expect(lessonCounter({ lessonsDone: 4, lessonsTotal: 4, state: 'completed' })).toBe(
      'Lesson 4 of 4',
    )
    expect(lessonCounter({ lessonsDone: 4, lessonsTotal: 4, state: 'current' })).toBe(
      'Lesson 4 of 4',
    )
    expect(lessonCounter({ lessonsDone: 0, lessonsTotal: 0, state: 'available' })).toBeNull()
  })

  it('builds popover actions', () => {
    expect(popoverAction('fixture', level('u01-l1', { state: 'current' }))).toEqual({
      type: 'start',
      label: 'Start',
      href: '/lesson?course=fixture&kind=lesson&level=u01-l1',
    })
    expect(popoverAction('fixture', level('u01-s0', { state: 'legendary' }))).toMatchObject({
      type: 'start',
      label: 'Replay',
    })
    expect(popoverAction('fixture', level('u01-l2', { state: 'locked' }))).toEqual({
      type: 'locked',
      message: LOCKED_MESSAGE,
    })
    expect(popoverAction('fixture', level('c', { kind: 'chest', state: 'available' })).type).toBe(
      'unavailable',
    )
    expect(popoverAction('fixture', level('z', { kind: 'zzz', state: 'completed' })).type).toBe(
      'unavailable',
    )
  })

  it('numbers units within their section and finds the current level', () => {
    const path = testPath([
      { id: 'u01-a', levels: [level('a1', { state: 'completed' })] },
      { id: 'u02-b', levels: [level('b1', { state: 'current' })] },
    ])
    path.sections.push({
      ...path.sections[0]!,
      id: 's2',
      units: [{ ...path.sections[0]!.units[0]!, id: 'u03-c', levels: [] }],
    })
    const pos = unitPositions(path)
    expect(pos.get('u01-a')).toEqual({ sectionNumber: 1, unitNumber: 1, pathIndex: 0 })
    expect(pos.get('u02-b')).toEqual({ sectionNumber: 1, unitNumber: 2, pathIndex: 1 })
    expect(pos.get('u03-c')).toEqual({ sectionNumber: 2, unitNumber: 1, pathIndex: 2 })
    expect(currentLevelId(path)).toBe('b1')
    expect(currentLevelId(FIXTURE_PATH)).toBe('u01-l1')
    expect(
      currentLevelId(testPath([{ id: 'u01-a', levels: [level('a1', { state: 'completed' })] }])),
    ).toBeNull()
  })

  it('accepts palette colors only', () => {
    expect(unitBrand('bademjan')).toBe('bademjan')
    expect(unitBrand('pesteh')).toBe('pesteh')
    expect(unitBrand('neon')).toBe('firouzeh')
  })
})

describe('letters mappers', () => {
  it('picks the CTA lesson: current, else the last completed, else the first available', () => {
    const [a, b] = TEST_LETTERS.lessons as [
      (typeof TEST_LETTERS.lessons)[0],
      (typeof TEST_LETTERS.lessons)[0],
    ]
    expect(ctaLesson([a, b])?.id).toBe('u01-letters-1')
    expect(
      ctaLesson([
        { ...a, state: 'completed' },
        { ...b, state: 'legendary' },
      ])?.id,
    ).toBe('u01-letters-2')
    expect(
      ctaLesson([
        { ...a, state: 'available' },
        { ...b, state: 'locked' },
      ])?.id,
    ).toBe('u01-letters-1')
    expect(ctaLesson([{ ...a, state: 'locked' }])).toBeNull()
    expect(ctaLesson([])).toBeNull()
  })

  it('builds letters lesson URLs and labels', () => {
    expect(lettersLessonHref('fixture', 'u01-letters-1')).toBe(
      '/lesson?course=fixture&kind=letters&level=u01-letters-1',
    )
    expect(lessonStateLabel('locked')).toBe('Locked')
    expect(lessonStateLabel('current')).toBe('Up next')
  })

  it("lists a lesson's letters, skipping unknown ids", () => {
    const lesson = { ...TEST_LETTERS.lessons[0]!, letters: ['l_dal', 'l_nope', 'l_alef'] }
    expect(lessonLetters(lesson, TEST_LETTERS.letters)).toEqual(['د', 'ا'])
  })
})
