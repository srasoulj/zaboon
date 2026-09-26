/**
 * The speak challenges the DOM tests use (speak-fixture.json) are exactly what the session engine
 * builds from content/fixtures (the jsdom project cannot read the course YAML). Re-record after an
 * engine or fixture change with:
 *   RECORD_SPEAK_FIXTURE=1 pnpm vitest run --project unit apps/web/components/speak
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Challenge } from '@zaboon/contracts'
import { buildChallenge } from '@zaboon/session-engine'
// Test support of the engine package (not exported): loads the fixture course straight from YAML.
import { loadCourse } from '../../../../packages/session-engine/src/test-support/load-course'

const JSON_PATH = fileURLToPath(new URL('./speak-fixture.json', import.meta.url))

function build(): Challenge[] {
  const content = loadCourse('fixtures').view('u01-fixture')
  return [
    buildChallenge({ type: 'speak', items: ['s_u01_0001'] }, 0, content),
    buildChallenge({ type: 'speak', items: ['s_u01_0007'] }, 1, content),
  ]
}

describe('recorded speak fixture', () => {
  const built = build()
  if (process.env.RECORD_SPEAK_FIXTURE === '1')
    writeFileSync(JSON_PATH, `${JSON.stringify(built, null, 2)}\n`)
  const recorded: unknown = JSON.parse(readFileSync(JSON_PATH, 'utf8'))

  it('matches what the session engine builds from content/fixtures', () => {
    expect(recorded).toEqual(JSON.parse(JSON.stringify(built)))
  })

  it('is schema-valid speak challenges with a translation', () => {
    for (const c of (recorded as unknown[]).map((x) => Challenge.parse(x))) {
      expect(c.type).toBe('speak')
      if (c.type === 'speak') expect(c.translation).toBeTruthy()
    }
  })
})
