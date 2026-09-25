/**
 * ORACLE (read-only, orchestrator-owned): MVP sessions stay byte-identical while Wave 3 features
 * are off. `mvp-sessions.golden.json` was recorded from the MVP engine (before the P2 mix
 * categories and `GenerateInput.features` existed) on the frozen fixture course, for fixed seeds
 * and learners. With every feature off — `features` absent, or all false — `generateSession` must
 * reproduce each recorded session exactly: the same refs, and the same challenges (compared by a
 * digest that leaves out answer graphs, which belong to @zaboon/grader, not the engine).
 *
 * Re-record ONLY for an intended MVP change the orchestrator approved:
 *   ZABOON_RECORD_GOLDEN=1 pnpm vitest run --project unit packages/session-engine/oracles
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG } from '@zaboon/contracts'
import type { ChallengeRef, FsrsCard, SessionKind } from '@zaboon/contracts'
import type { LessonSpec, UnitBundle } from '@zaboon/content-schema'
import { generateSession } from '../src/index'
import type { ContentView, GenerateInput, LearnerState } from '../src/index'
import { loadCourse } from '../src/test-support/load-course'

const GOLDEN = new URL('./mvp-sessions.golden.json', import.meta.url)
const RECORD = process.env.ZABOON_RECORD_GOLDEN === '1'
const NOW = new Date('2026-09-25T12:00:00Z')
const SEEDS = ['golden-a', 'golden-b', 'golden-c'] as const

const fixture = loadCourse('fixtures')
const unitView = fixture.view('u01-fixture')
const lettersView = fixture.view(null)

/** The fixture unit plus a generated (not pinned) lesson `u01-gen` built from `spec`. */
function generated(spec: Partial<LessonSpec>): ContentView {
  const unit = unitView.unit!
  const base: LessonSpec = {
    focus: { lexemes: [], sentences: [], letters: [], chats: [] },
    mix: 'intro',
    pinned: [],
    pinnedOnly: false,
  }
  const bundle: UnitBundle = {
    ...unit,
    unit: {
      ...unit.unit,
      levels: [
        ...unit.unit.levels,
        { id: 'u01-gen', kind: 'lesson', lessons: 3, spec: { ...base, ...spec } },
      ],
    },
  }
  return { ...unitView, unit: bundle }
}

/** A literal FSRS card (independent of @zaboon/srs scheduling), due at `due`. */
const card = (due: string): FsrsCard => ({
  due,
  stability: 4,
  difficulty: 5,
  elapsedDays: 3,
  scheduledDays: 4,
  learningSteps: 0,
  reps: 2,
  lapses: 0,
  state: 2,
  lastReview: '2026-09-01T12:00:00.000Z',
})
const PAST = '2026-09-20T12:00:00.000Z'
const FUTURE = '2026-10-20T12:00:00.000Z'
const cards = (ids: readonly string[], due: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, card(due.includes(id) ? PAST : FUTURE)]))

const LEXEMES = [
  'lx_salam',
  'lx_mersi',
  'lx_khub',
  'lx_man',
  'lx_to',
  'lx_ab',
  'lx_nun',
  'lx_chay',
  'lx_sib',
  'lx_mikham',
  'lx_maman',
  'lx_baba',
  'lx_bad',
  'lx_ruz',
]
const LETTERS = ['l_alef', 'l_be', 'l_dal', 'l_re', 'l_ze', 'l_sin', 'l_mim', 'l_nun', 'l_vav', 'l_ye']

const fresh: LearnerState = { lexemeCards: {}, letterCards: {}, mistakes: [], exposures: {} }
const experienced: LearnerState = {
  lexemeCards: cards(LEXEMES, ['lx_ab', 'lx_nun', 'lx_chay']),
  letterCards: cards(LETTERS, ['l_be', 'l_sin']),
  mistakes: ['sentence:s_u01_0002', 'lexeme:lx_sib'],
  exposures: {},
}

interface Scenario {
  name: string
  content: ContentView
  kind: SessionKind
  levelId: string | null
  lessonIndex: number
  learner: LearnerState
}

const scenario = (
  name: string,
  content: ContentView,
  kind: SessionKind,
  levelId: string | null,
  learner: LearnerState,
  lessonIndex = 0,
): Scenario => ({ name, content, kind, levelId, lessonIndex, learner })

const letterFocus = { lexemes: [], sentences: [], letters: ['l_be', 'l_mim', 'l_nun'], chats: [] }

const scenarios: Scenario[] = [
  scenario('lesson u01-s0', unitView, 'lesson', 'u01-s0', fresh),
  scenario('lesson u01-l1', unitView, 'lesson', 'u01-l1', fresh),
  scenario('lesson u01-l2', unitView, 'lesson', 'u01-l2', fresh),
  scenario('practice (fresh)', unitView, 'practice', null, fresh),
  scenario('practice (experienced)', unitView, 'practice', null, experienced),
  scenario('unit_review u01-r1 (fresh)', unitView, 'unit_review', 'u01-r1', fresh),
  scenario('unit_review u01-r1 (experienced)', unitView, 'unit_review', 'u01-r1', experienced),
  scenario('letters u01-letters-1', lettersView, 'letters', 'u01-letters-1', fresh),
  scenario('letters u01-letters-2 (experienced)', lettersView, 'letters', 'u01-letters-2', experienced),
  scenario('letters (all known)', lettersView, 'letters', null, experienced),
  scenario('generated intro lesson', generated({ mix: 'intro' }), 'lesson', 'u01-gen', fresh),
  scenario('generated standard lesson #3', generated({ mix: 'standard' }), 'lesson', 'u01-gen', experienced, 2),
  scenario('generated letters-mix lesson', generated({ mix: 'letters', focus: letterFocus }), 'lesson', 'u01-gen', fresh),
  scenario('legendary', generated({ mix: 'standard' }), 'legendary', 'u01-gen', experienced),
  scenario('jump_test', unitView, 'jump_test', null, fresh),
]

interface Recorded {
  scenario: string
  seed: string
  refs: ChallengeRef[]
  /** sha256 of the challenges' JSON with every answer graph left out. */
  challenges: string
}

function withoutGraphs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGraphs)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== 'graph')
        .map(([k, v]) => [k, withoutGraphs(v)]),
    )
  return value
}

function run(sc: Scenario, seed: string, extra: Partial<GenerateInput> = {}): Recorded {
  const s = generateSession({
    content: sc.content,
    kind: sc.kind,
    levelId: sc.levelId,
    lessonIndex: sc.lessonIndex,
    learner: sc.learner,
    seed,
    now: NOW,
    config: DEFAULT_APP_CONFIG,
    ...extra,
  })
  return {
    scenario: sc.name,
    seed,
    refs: JSON.parse(JSON.stringify(s.refs)) as ChallengeRef[],
    challenges: createHash('sha256').update(JSON.stringify(withoutGraphs(s.challenges))).digest('hex'),
  }
}

const cases = scenarios.flatMap((sc) => SEEDS.map((seed) => ({ sc, seed })))

if (RECORD) {
  writeFileSync(GOLDEN, `${JSON.stringify(cases.map(({ sc, seed }) => run(sc, seed)), null, 1)}\n`)
}

const golden: Recorded[] = existsSync(GOLDEN)
  ? (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Recorded[])
  : []
const recorded = (sc: Scenario, seed: string) =>
  golden.find((g) => g.scenario === sc.name && g.seed === seed)

describe('oracles/mvp-sessions.golden.json', () => {
  it(`has ${cases.length} recorded sessions`, () => {
    expect(golden).toHaveLength(cases.length)
  })

  describe('features absent', () => {
    it.each(cases.map(({ sc, seed }) => [`${sc.name} / ${seed}`, sc, seed] as const))(
      '%s',
      (_, sc, seed) => {
        expect(run(sc, seed)).toEqual(recorded(sc, seed))
      },
    )
  })
})
