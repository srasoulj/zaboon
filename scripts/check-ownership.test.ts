import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check, globToRegExp, workstreamFor } from './check-ownership'

const own = JSON.parse(readFileSync(new URL('../ops/ownership.json', import.meta.url), 'utf8'))

describe('check-ownership', () => {
  it('globs', () => {
    expect(globToRegExp('packages/farsi/**').test('packages/farsi/src/index.ts')).toBe(true)
    expect(globToRegExp('**/oracles/**').test('packages/grader/oracles/golden.yaml')).toBe(true)
    expect(globToRegExp('apps/web/app/(app)/learn/**').test('apps/web/app/(app)/learn/page.tsx')).toBe(true)
  })
  it('maps branches to workstreams', () => {
    expect(workstreamFor('claude/zaboon-ws-db', own)).toBe('ws-db')
    expect(workstreamFor('claude/zaboon-ws-qa-3', own)).toBe('ws-qa')
    expect(workstreamFor('feature/x', own)).toBeNull()
  })
  it('allows owned paths and the lockfile, rejects protected and foreign paths', () => {
    expect(check(['packages/farsi/src/index.ts', 'pnpm-lock.yaml'], 'claude/zaboon-ws-farsi-grader', own)).toEqual([])
    expect(check(['packages/grader/oracles/golden.yaml'], 'claude/zaboon-ws-farsi-grader', own)).toHaveLength(1)
    expect(check(['packages/db/src/index.ts'], 'claude/zaboon-ws-farsi-grader', own)).toHaveLength(1)
    expect(check(['CLAUDE.md'], 'claude/affectionate-ptolemy-b4ypuw', own)).toEqual([])
  })
})
