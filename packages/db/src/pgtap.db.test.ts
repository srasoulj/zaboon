/**
 * Runs the pgTAP suites in supabase/tests/*.sql (docs/ARCHITECTURE.md §9, §15) against a private
 * clone of the migrated template, the way pg_prove would: each file through psql, as the cluster
 * superuser (the files switch roles themselves), then the TAP output is checked for a complete
 * plan with no failures.
 */
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './testing'

const run = promisify(execFile)
const TESTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'supabase',
  'tests',
)
const files = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

interface TapSummary {
  planned: number | null
  passed: number
  failed: string[]
  diagnostics: string[]
}

function parseTap(output: string): TapSummary {
  const summary: TapSummary = { planned: null, passed: 0, failed: [], diagnostics: [] }
  for (const line of output.split('\n')) {
    const plan = /^1\.\.(\d+)$/.exec(line.trim())
    if (plan) summary.planned = Number(plan[1])
    else if (/^ok \d+/.test(line)) summary.passed++
    else if (/^not ok \d+/.test(line)) summary.failed.push(line)
    else if (line.startsWith('#')) summary.diagnostics.push(line)
  }
  return summary
}

let tdb: TestDatabase

beforeAll(async () => {
  tdb = await createTestDatabase()
})
afterAll(() => tdb.drop())

describe('pgTAP', () => {
  it('finds the suites', () => {
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  it.each(files)('%s passes', async (file) => {
    const url = new URL(tdb.adminUrl)
    const { stdout, stderr } = await run(
      'psql',
      [
        '-X',
        '-q',
        '-t',
        '-A',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        url.hostname,
        '-p',
        url.port,
        '-U',
        url.username,
        '-d',
        tdb.name,
        '-f',
        join(TESTS_DIR, file),
      ],
      { env: { ...process.env, PGOPTIONS: '--client-min-messages=warning' } },
    ).catch((err: { stdout?: string; stderr?: string; message: string }) => {
      throw new Error(
        `psql failed for ${file}: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      )
    })
    const tap = parseTap(stdout)
    const report = [...tap.failed, ...tap.diagnostics, stderr].filter(Boolean).join('\n')
    expect(tap.failed, report).toEqual([])
    expect(tap.planned, `no plan in ${file}\n${stdout}`).not.toBeNull()
    expect(tap.passed, report).toBe(tap.planned)
  })
})

describe('parseTap', () => {
  it('counts results and plan', () => {
    expect(parseTap('1..3\nok 1 - a\nnot ok 2 - b\n# Failed test 2\nok 3 - c\n')).toEqual({
      planned: 3,
      passed: 2,
      failed: ['not ok 2 - b'],
      diagnostics: ['# Failed test 2'],
    })
  })
})
