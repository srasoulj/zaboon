/**
 * Migration files and how they are applied (docs/adr/0009). Shared by the local runner
 * (scripts/migrate.ts) and the release that runs in the Vercel build (scripts/release.ts). Both do
 * what `supabase db push` does: every supabase/migrations/<version>_<name>.sql runs as the
 * non-superuser `postgres` role in its own transaction and is recorded in
 * supabase_migrations.schema_migrations (version, name, statements), so the CLI and this code can
 * take turns on the same database.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type postgres from 'postgres'
import type { MigrationFile } from './migrate-key'

export type { MigrationFile } from './migrate-key'

/** The migration files of `dir` in version order (other files are ignored). */
export function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const [version, ...rest] = file.replace(/\.sql$/, '').split('_')
      return {
        version: version!,
        name: rest.join('_'),
        sql: readFileSync(join(dir, file), 'utf8'),
      }
    })
}

/**
 * The Supabase CLI's history table, created only when missing (a project that has never seen
 * `supabase db push`): `CREATE SCHEMA IF NOT EXISTS` needs CREATE on the database even when the
 * schema exists, which the migration role need not have on a database it doesn't own. A table an
 * older CLI made with `version` alone gets the two columns the CLI adds today.
 */
async function ensureHistoryTable(sql: postgres.Sql): Promise<void> {
  const [table] = await sql`SELECT to_regclass('supabase_migrations.schema_migrations') AS t`
  if (!table?.t) {
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS supabase_migrations')
    await sql.unsafe(
      'CREATE TABLE supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text)',
    )
    return
  }
  const columns = new Set(
    (
      await sql`SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'`
    ).map((r) => r.column_name as string),
  )
  if (!columns.has('statements'))
    await sql.unsafe(
      'ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN statements text[]',
    )
  if (!columns.has('name'))
    await sql.unsafe('ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN name text')
}

/**
 * Applies the migrations not recorded yet, in order, and returns their `<version>_<name>`s.
 * Each one runs in its own transaction under an advisory lock and re-checks the history inside
 * it, so two runners on one database (two builds of the same commit, say) apply it once: the
 * second finds it recorded and moves on.
 */
export async function applyMigrations(
  sql: postgres.Sql,
  migrations: readonly MigrationFile[],
  log: (line: string) => void = () => {},
): Promise<string[]> {
  await ensureHistoryTable(sql)
  const recorded = new Set(
    (await sql`SELECT version FROM supabase_migrations.schema_migrations`).map(
      (r) => r.version as string,
    ),
  )
  const applied: string[] = []
  for (const m of migrations) {
    if (recorded.has(m.version)) continue
    const done = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('zaboon:migrate', 0))`
      const [row] =
        await tx`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${m.version}`
      if (row) return false
      await tx.unsafe(m.sql)
      await tx`INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
               VALUES (${m.version}, ${m.name}, ${[m.sql]})`
      return true
    })
    if (!done) continue
    applied.push(`${m.version}_${m.name}`)
    log(`applied ${m.version}_${m.name}`)
  }
  return applied
}
