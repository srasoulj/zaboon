/**
 * What the local template database (`<db>_template`, which every DB test clones) was built from: a
 * digest of the local shim and of every migration (version, name and SQL), with their count.
 * scripts/migrate.ts rebuilds the template whenever the key changes. That includes a migration
 * dated before the newest one but merged after it, which a key made only of the last version
 * misses: the template would then lack that migration while the main database has it.
 */
import { createHash } from 'node:crypto'

export interface MigrationFile {
  version: string
  name: string
  sql: string
}

export function templateKey(migrations: readonly MigrationFile[], shim: string): string {
  const hash = createHash('sha256').update(shim)
  for (const m of migrations) hash.update(`\u0000${m.version}_${m.name}\u0000${m.sql}`)
  return `${migrations.length}:${hash.digest('hex').slice(0, 32)}`
}
