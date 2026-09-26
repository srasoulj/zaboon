/**
 * The story beats the DOM tests use (story-fixture.json) are exactly what the session engine
 * builds from content/fixtures (the jsdom project cannot read the course YAML). Re-record after an
 * engine or fixture change with:
 *   RECORD_STORY_FIXTURE=1 pnpm vitest run --project unit apps/web/components/stories
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Challenge } from '@zaboon/contracts'
import { buildChallenge, encodeVariant } from '@zaboon/session-engine'
// Test support of the engine package (not exported): loads the fixture course straight from YAML.
import { loadCourse } from '../../../../packages/session-engine/src/test-support/load-course'

const JSON_PATH = fileURLToPath(new URL('./story-fixture.json', import.meta.url))

function build(): Challenge[] {
  const content = loadCourse('fixtures').view('u01-fixture')
  return [0, 1, 2].map((beat) =>
    buildChallenge(
      { type: 'story', items: ['st_u01_tea'], variant: encodeVariant({ option: beat }) },
      beat,
      content,
    ),
  )
}

describe('recorded story fixture', () => {
  const built = build()
  if (process.env.RECORD_STORY_FIXTURE === '1')
    writeFileSync(JSON_PATH, `${JSON.stringify(built, null, 2)}\n`)
  const recorded: unknown = JSON.parse(readFileSync(JSON_PATH, 'utf8'))

  it('matches what the session engine builds from content/fixtures', () => {
    expect(recorded).toEqual(JSON.parse(JSON.stringify(built)))
  })

  it('is the fixture story: three schema-valid beats, the last one closing', () => {
    const beats = (recorded as unknown[]).map((x) => Challenge.parse(x))
    expect(beats.map((c) => (c.type === 'story' ? [c.beat, c.beats, !!c.question] : null))).toEqual(
      [
        [0, 3, true],
        [1, 3, true],
        [2, 3, false],
      ],
    )
  })
})
