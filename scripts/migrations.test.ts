import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadMigrations } from './migrations'

const dir = mkdtempSync(join(tmpdir(), 'zaboon-migrations-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('loadMigrations', () => {
  it('lists <version>_<name>.sql files in version order and ignores everything else', () => {
    writeFileSync(join(dir, '20260102000000_two_words.sql'), 'SELECT 2;')
    writeFileSync(join(dir, '20260101000000_one.sql'), 'SELECT 1;')
    writeFileSync(join(dir, '20260103000000_bad-name.sql'), 'SELECT 3;')
    writeFileSync(join(dir, 'README.md'), '# not a migration')
    expect(loadMigrations(dir)).toEqual([
      { version: '20260101000000', name: 'one', sql: 'SELECT 1;' },
      { version: '20260102000000', name: 'two_words', sql: 'SELECT 2;' },
    ])
  })
})
