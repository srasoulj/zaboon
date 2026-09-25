/** Test data for the path, letters and practice screens (no JSX: unit tests import it too). */
import {
  DEFAULT_SETTINGS,
  type HomeResponse,
  type LettersResponse,
  type PathResponse,
} from '@zaboon/contracts'

export const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'

type Level = PathResponse['sections'][number]['units'][number]['levels'][number]

export function level(id: string, over: Partial<Level> = {}): Level {
  return { id, kind: 'lesson', lessonsTotal: 1, lessonsDone: 0, state: 'locked', ...over }
}

/** A one-section path; units default to the fixture unit's shape. */
export function testPath(
  units: {
    id: string
    title?: string
    subtitle?: string
    color?: string
    hasGuidebook?: boolean
    levels: Level[]
  }[],
): PathResponse {
  return {
    courseId: 'fixture',
    contentVersion: 1,
    sections: [
      {
        id: 's1',
        title: 'Section 1',
        cefr: 'A1',
        units: units.map((u) => ({
          id: u.id,
          title: u.title ?? 'Fixture unit',
          ...(u.subtitle === undefined ? {} : { subtitle: u.subtitle }),
          color: (u.color ??
            'firouzeh') as PathResponse['sections'][number]['units'][number]['color'],
          hasGuidebook: u.hasGuidebook ?? true,
          levels: u.levels,
        })),
      },
    ],
  }
}

/** The fixture course path after u01-s0 is done. */
export const FIXTURE_PATH: PathResponse = testPath([
  {
    id: 'u01-fixture',
    subtitle: 'Hello, tea and first letters',
    levels: [
      level('u01-s0', { title: 'First steps', state: 'completed', lessonsDone: 1 }),
      level('u01-l1', { title: 'Course challenges', state: 'current' }),
      level('u01-l2', { title: 'Letter challenges' }),
      level('u01-p1', { kind: 'practice', title: 'Practice', lessonsTotal: 0 }),
      level('u01-r1', { kind: 'unit_review', title: 'Unit review' }),
    ],
  },
])

export function testHome(courseId = 'fixture'): HomeResponse {
  return {
    user: {
      id: TEST_USER_ID,
      isAnonymous: true,
      displayName: null,
      username: null,
      ageConfirmed: true,
      onboarded: true,
    },
    course: { id: courseId, contentVersion: 1, currentLevelId: 'u01-l1' },
    streak: {
      current: 1,
      longest: 1,
      status: 'extended',
      freezes: 0,
      lastActiveDay: null,
    } as unknown as HomeResponse['streak'],
    lives: {
      policy: 'limited',
      count: 5,
      max: 5,
      nextRegenAt: null,
    } as unknown as HomeResponse['lives'],
    dailyGoal: { xp: 0, goal: 20, met: false },
    xpTotal: 0,
    settings: DEFAULT_SETTINGS,
    flags: {} as HomeResponse['flags'],
  }
}

export const TEST_LETTERS: LettersResponse = {
  letters: [
    {
      id: 'l_alef',
      letter: 'ا',
      name: 'alef',
      translit: 'ā/a',
      strength: 3,
      introduced: true,
      audio: '/content/a.mp3',
    },
    { id: 'l_be', letter: 'ب', name: 'be', translit: 'b', strength: 1, introduced: true },
    {
      id: 'l_dal',
      letter: 'د',
      name: 'dāl',
      translit: 'd',
      strength: 0,
      introduced: false,
      audio: '/content/d.mp3',
    },
  ],
  lessons: [
    {
      id: 'u01-letters-1',
      title: 'Letters that never connect',
      letters: ['l_alef', 'l_dal'],
      state: 'current',
    },
    { id: 'u01-letters-2', title: 'First connecting letters', letters: ['l_be'], state: 'locked' },
  ],
}
