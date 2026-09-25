import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check, globToRegExp, owns, workstreamFor } from './check-ownership'

const own = JSON.parse(readFileSync(new URL('../ops/ownership.json', import.meta.url), 'utf8'))
const paths = (ws: string): string[] => own.workstreams[ws].paths

/** A concrete file a glob matches (`**` → a nested file, `*` → a name). */
const sample = (glob: string) =>
  glob.replace(/\*\*$/, 'x/sample.ts').replace(/\*\*\//g, 'x/').replace(/\*/g, 'sample')

describe('Wave 3 ownership', () => {
  const engagement = 'claude/zaboon-ws-engagement'
  const typing = 'claude/zaboon-ws-typing'

  it('excludes `!` paths', () => {
    expect(owns('packages/db/src/repos/sessions.ts', ['packages/db/**'])).toBe(true)
    expect(owns('packages/db/src/schema.ts', ['packages/db/**', '!packages/db/src/schema.ts'])).toBe(
      false,
    )
    expect(owns('packages/db/src/index.ts', ['!packages/db/**'])).toBe(false)
  })

  it('routes the engagement and typing files to their workstreams', () => {
    const toEngagement = [
      'apps/web/app/(app)/leaderboard/page.tsx',
      'apps/web/app/(app)/practice/page.tsx',
      'apps/web/app/api/cron/league-rollover/route.ts',
      'apps/web/app/api/lives/refill/route.ts',
      'apps/web/app/api/sessions/[id]/complete/route.ts',
      'apps/web/lib/server/sessions.ts',
      'apps/web/lib/server/engagement/leagues.ts',
      'apps/web/components/engagement/Rail.tsx',
      'apps/web/components/lesson/CompleteScreens.tsx',
      'apps/web/lib/lesson/machine.ts',
      'packages/game-rules/src/engagement.ts',
      'packages/db/src/repos/wallet.ts',
      'packages/db/src/schema.ts',
      'supabase/migrations/20260926000000_engagement.sql',
      'apps/web/tests/engagement/shop.db.test.ts',
      'e2e/engagement/leaderboard.spec.ts',
    ]
    const toTyping = [
      'packages/farsi/src/keyboard.ts',
      'packages/ui/src/components/PersianKeyboard.tsx',
      'packages/session-engine/src/builders.ts',
      'apps/web/components/challenges/LetterTrace.tsx',
      'apps/web/app/(dev)/challenges/page.tsx',
      'apps/web/lib/lesson/grading.ts',
      'apps/web/lib/typing/trace-score.ts',
      'apps/web/tests/typing/u01-t1.db.test.ts',
      'e2e/typing/keyboard.spec.ts',
      'e2e/renderers/renderers.spec.ts',
    ]
    expect(check(toEngagement, engagement, own)).toEqual([])
    expect(check(toTyping, typing, own)).toEqual([])
    expect(check(toEngagement, typing, own)).toHaveLength(toEngagement.length)
    expect(check(toTyping, engagement, own)).toHaveLength(toTyping.length)
  })

  it('keeps the Wave 3 seams and oracles protected', () => {
    const seams = [
      'packages/contracts/src/schemas.ts',
      'packages/game-rules/oracles/engagement.yaml',
      'packages/session-engine/oracles/mvp-sessions.golden.json',
      'apps/web/components/shell/AppShell.tsx',
      'apps/web/lib/challenge-registry.ts',
      'apps/web/lib/server/with-route.ts',
      'apps/web/lib/server/flags.ts',
      'apps/web/tests/api/harness.ts',
      'apps/web/vercel.json',
      'content/fixtures/units/u01-fixture.yaml',
      'e2e/fixtures/cron.ts',
      'playwright.config.ts',
    ]
    for (const branch of [engagement, typing])
      expect(check(seams, branch, own).every((p) => p.endsWith('protected (orchestrator-owned)'))).toBe(
        true,
      )
  })

  it('no two workstreams of Waves 1-3 own the same path (ws-qa is cross-cutting)', () => {
    const active = Object.keys(own.workstreams).filter((ws) => ws !== 'ws-qa')
    for (const a of ['ws-engagement', 'ws-typing'])
      for (const glob of paths(a)) {
        const file = sample(glob)
        expect(owns(file, paths(a)), `${a} owns ${file}`).toBe(true)
        for (const b of active.filter((ws) => ws !== a))
          expect(owns(file, paths(b)), `${file}: ${a} and ${b}`).toBe(false)
      }
  })
})

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
    // (packages/farsi/src/index.ts moved to ws-typing in Wave 3; normalize.ts stays.)
    expect(check(['packages/farsi/src/normalize.ts', 'pnpm-lock.yaml'], 'claude/zaboon-ws-farsi-grader', own)).toEqual([])
    expect(check(['packages/farsi/src/index.ts'], 'claude/zaboon-ws-farsi-grader', own)).toHaveLength(1)
    expect(check(['packages/grader/oracles/golden.yaml'], 'claude/zaboon-ws-farsi-grader', own)).toHaveLength(1)
    expect(check(['packages/db/src/index.ts'], 'claude/zaboon-ws-farsi-grader', own)).toHaveLength(1)
    expect(check(['CLAUDE.md'], 'claude/affectionate-ptolemy-b4ypuw', own)).toEqual([])
  })
})
