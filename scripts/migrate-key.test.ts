import { describe, expect, it } from 'vitest'
import { templateKey, type MigrationFile } from './migrate-key'

const m = (version: string, sql = `-- ${version}`): MigrationFile => ({
  version,
  name: `m${version.slice(-4)}`,
  sql,
})
const SHIM = '-- shim'

describe('templateKey (when the local DB-test template is rebuilt)', () => {
  const base = [m('20260926000000'), m('20260927000000')]

  it('is stable for the same migrations and shim', () => {
    expect(templateKey(base, SHIM)).toBe(templateKey([...base], SHIM))
    expect(templateKey(base, SHIM)).toMatch(/^2:[0-9a-f]{32}$/)
  })

  it('changes when an earlier-dated migration arrives after the newest one', () => {
    const later = [m('20260926000000'), m('20260926100000'), m('20260927000000')]
    expect(later.at(-1)!.version).toBe(base.at(-1)!.version)
    expect(templateKey(later, SHIM)).not.toBe(templateKey(base, SHIM))
  })

  it('changes when a migration file or the shim changes', () => {
    const edited = [m('20260926000000'), m('20260927000000', '-- edited')]
    expect(templateKey(edited, SHIM)).not.toBe(templateKey(base, SHIM))
    expect(templateKey(base, '-- shim v2')).not.toBe(templateKey(base, SHIM))
  })
})
