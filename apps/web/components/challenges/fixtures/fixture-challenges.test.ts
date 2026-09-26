/**
 * The recorded fixture challenges (fixture-challenges.json) are exactly what the session engine
 * builds for the frozen fixture lessons u01-l1 (8 course types) and u01-l2 (5 letter types), plus
 * `buildChallenge` of a single-letter letter_forms ref (l_be), plus the P2 level u01-t1 with its
 * features on (typed Persian translate_type, listen_type, cloze_type, letter_trace), plus the speak
 * challenges of u01-v1 (Wave 4).
 * Re-record after an engine or fixture change with:
 *   RECORD_FIXTURE_CHALLENGES=1 pnpm vitest run --project unit apps/web/components/challenges
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Challenge, DEFAULT_APP_CONFIG, MVP_CHALLENGE_TYPES } from '@zaboon/contracts'
import type { SessionFeatures } from '@zaboon/session-engine'
import { buildChallenge, generateSession } from '@zaboon/session-engine'
// Test support of the engine package (not exported): loads the fixture course straight from YAML.
import { loadCourse } from '../../../../../packages/session-engine/src/test-support/load-course'

const JSON_PATH = fileURLToPath(new URL('./fixture-challenges.json', import.meta.url))

function build(): Challenge[] {
  const content = loadCourse('fixtures').view('u01-fixture')
  const lesson = (levelId: string, features?: SessionFeatures) =>
    generateSession({
      ...(features ? { features } : {}),
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
  const p2 = lesson('u01-t1', { persianTyping: true, letterTrace: true })
  // Wave 4: the speak challenges of u01-v1 (its listen_tap pin is already covered above).
  const speak = lesson('u01-v1', { speak: true }).filter((c) => c.type === 'speak')
  return [...lesson('u01-l1'), ...lesson('u01-l2'), oneLetter, ...p2, ...speak]
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

  it('are schema-valid and cover all 13 MVP types and the P2 typing and tracing types', () => {
    const parsed = (recorded as unknown[]).map((c) => Challenge.parse(c))
    expect(new Set(parsed.map((c) => c.type))).toEqual(
      new Set([...MVP_CHALLENGE_TYPES, 'listen_type', 'cloze_type', 'letter_trace', 'speak']),
    )
    expect(parsed.some((c) => c.type === 'translate_type' && c.answerLang === 'fa')).toBe(true)
  })
})
