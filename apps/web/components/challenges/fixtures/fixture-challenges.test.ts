/**
 * The recorded fixture challenges (fixture-challenges.json) are exactly what the session engine
 * builds for the frozen fixture lessons u01-l1 (8 course types) and u01-l2 (5 letter types), plus
 * `buildChallenge` of a single-letter letter_forms ref (l_be).
 * Re-record after an engine or fixture change with:
 *   RECORD_FIXTURE_CHALLENGES=1 pnpm vitest run --project unit apps/web/components/challenges
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Challenge, DEFAULT_APP_CONFIG, MVP_CHALLENGE_TYPES } from '@zaboon/contracts'
import { buildChallenge, generateSession } from '@zaboon/session-engine'
// Test support of the engine package (not exported): loads the fixture course straight from YAML.
import { loadCourse } from '../../../../../packages/session-engine/src/test-support/load-course'

const JSON_PATH = fileURLToPath(new URL('./fixture-challenges.json', import.meta.url))

function build(): Challenge[] {
  const content = loadCourse('fixtures').view('u01-fixture')
  const lesson = (levelId: string) =>
    generateSession({
      content,
      kind: 'lesson',
      levelId,
      lessonIndex: 0,
      learner: { lexemeCards: {}, letterCards: {}, mistakes: [], exposures: {} },
      seed: 'renderers',
      now: new Date('2026-09-25T00:00:00Z'),
      config: DEFAULT_APP_CONFIG,
    }).challenges
  // Plus the single-letter letter_forms shape (position names → shapes), which no fixture lesson pins.
  const oneLetter = buildChallenge({ type: 'letter_forms', items: ['l_be'] }, 5, content)
  return [...lesson('u01-l1'), ...lesson('u01-l2'), oneLetter]
}

describe('recorded fixture challenges', () => {
  const built = build()
  if (process.env.RECORD_FIXTURE_CHALLENGES === '1') {
    writeFileSync(JSON_PATH, `${JSON.stringify(built, null, 2)}\n`)
  }
  // Read from disk (not a module import) so record mode compares against what it just wrote.
  const recorded: unknown = JSON.parse(readFileSync(JSON_PATH, 'utf8'))

  it('match what the session engine builds from content/fixtures', () => {
    expect(recorded).toEqual(JSON.parse(JSON.stringify(built)))
  })

  it('are schema-valid and cover all 13 MVP types', () => {
    const parsed = (recorded as unknown[]).map((c) => Challenge.parse(c))
    expect(new Set(parsed.map((c) => c.type))).toEqual(new Set(MVP_CHALLENGE_TYPES))
  })
})
