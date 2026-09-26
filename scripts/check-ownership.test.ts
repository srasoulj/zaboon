import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check, globToRegExp, owns, workstreamFor } from './check-ownership'

const own = JSON.parse(readFileSync(new URL('../ops/ownership.json', import.meta.url), 'utf8'))
const paths = (ws: string): string[] => own.workstreams[ws].paths

/** A concrete file a glob matches (`**` → a nested file, `*` → a name). */
const sample = (glob: string) =>
  glob.replace(/\*\*$/, 'x/sample.ts').replace(/\*\*\//g, 'x/').replace(/\*/g, 'sample')

describe('Wave 4 ownership', () => {
  const engagement = 'claude/zaboon-ws-engagement'
  const typing = 'claude/zaboon-ws-typing-2'

  it('excludes `!` paths', () => {
    expect(owns('packages/db/src/repos/sessions.ts', ['packages/db/**'])).toBe(true)
    expect(owns('packages/db/src/schema.ts', ['packages/db/**', '!packages/db/src/schema.ts'])).toBe(
      false,
    )
    expect(owns('packages/db/src/index.ts', ['!packages/db/**'])).toBe(false)
  })

  it('routes the Wave 3 files and the Wave 4 (speak, stories) files to ws-typing', () => {
    const toTyping = [
      // Wave 3, formerly ws-engagement (done)
      'apps/web/app/(app)/leaderboard/page.tsx',
      'apps/web/app/api/cron/league-rollover/route.ts',
      'apps/web/app/api/sessions/[id]/complete/route.ts',
      'apps/web/lib/server/sessions.ts',
      'apps/web/lib/server/engagement/leagues.ts',
      'apps/web/components/lesson/CompleteScreens.tsx',
      'apps/web/lib/lesson/machine.ts',
      'packages/game-rules/src/engagement.ts',
      'packages/db/src/repos/wallet.ts',
      'packages/db/src/schema.ts',
      'supabase/migrations/20260926000000_engagement.sql',
      // Wave 3, ws-typing
      'packages/farsi/src/keyboard.ts',
      'packages/ui/src/components/PersianKeyboard.tsx',
      'packages/session-engine/src/builders.ts',
      'apps/web/components/challenges/LetterTrace.tsx',
      'apps/web/lib/lesson/grading.ts',
      'e2e/typing/keyboard.spec.ts',
      // the lesson player (formerly ws-player) and the path UI (formerly ws-path-letters)
      'apps/web/lib/lesson/outbox.ts',
      'apps/web/app/lesson/page.tsx',
      'apps/web/components/path/path-model.ts',
      'apps/web/app/(app)/learn/page.tsx',
      'e2e/path/path.spec.ts',
      // Wave 4
      'apps/web/app/api/speech/transcribe/route.ts',
      'apps/web/lib/server/speech/verify.ts',
      'apps/web/lib/speech/service.ts',
      'apps/web/components/speak/Speak.tsx',
      'apps/web/components/stories/Story.tsx',
      'apps/web/lib/server/stories/plan.ts',
      'packages/ai/src/transcribe.ts',
      'tools/content-cli/src/validate.ts',
      'packages/db/src/repos/speech.ts',
      'supabase/migrations/20260927000100_speech.sql',
      'supabase/tests/006_speech.sql',
      'content/fixtures/units/u01-fixture.yaml',
      'content/fixtures/stories/u01-fixture.yaml',
      'apps/web/tests/stories/u01-st1.db.test.ts',
      'e2e/speak/speak.spec.ts',
    ]
    expect(check(toTyping, typing, own)).toEqual([])
    // ws-engagement is done: it owns nothing any more.
    expect(check(toTyping, engagement, own)).toHaveLength(toTyping.length)
  })

  it('keeps the seams, oracles, frozen fixture content and fa-en content protected', () => {
    const seams = [
      'packages/contracts/src/schemas.ts',
      'packages/content-schema/src/index.ts',
      'packages/game-rules/oracles/engagement.yaml',
      'packages/session-engine/oracles/mvp-sessions.golden.json',
      'packages/ai/ai.models.yaml',
      'apps/web/components/shell/AppShell.tsx',
      'apps/web/lib/challenge-registry.ts',
      'apps/web/lib/server/with-route.ts',
      'apps/web/lib/server/signing.ts',
      'apps/web/tests/api/harness.ts',
      'apps/web/vercel.json',
      'content/fixtures/lexemes/u01-fixture.yaml',
      'content/fixtures/sentences/u01-fixture.yaml',
      'content/fixtures/assets/audio/s_u01_0001.mp3',
      'content/fixtures/course.yaml',
      'content/fa-en/units/u01-hello.yaml',
      'e2e/fixtures/browser-fakes.ts',
      'playwright.config.ts',
    ]
    const problems = check(seams, typing, own)
    expect(problems).toHaveLength(seams.length)
    // ai.models.yaml is not protected, it is excluded from ws-typing's packages/ai/**.
    expect(problems.filter((p) => !p.endsWith('protected (orchestrator-owned)'))).toEqual([
      'packages/ai/ai.models.yaml: outside ws-typing paths',
    ])
  })

  it('no two workstreams own the same path (ws-qa is cross-cutting)', () => {
    const active = Object.keys(own.workstreams).filter((ws) => ws !== 'ws-qa')
    for (const a of active)
      for (const glob of paths(a).filter((g) => !g.startsWith('!'))) {
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
