/**
 * Local migration runner. Production uses `supabase db push`; this script mirrors its behavior for
 * the local Postgres started by scripts/db-local.sh.
 *
 * 1. Applies supabase/local/shim.sql as the superuser (local-only Supabase emulation).
 * 2. Applies supabase/migrations/<version>_<name>.sql in order as the NON-superuser `postgres`
 *    role, each in its own transaction, recording them in supabase_migrations.schema_migrations
 *    exactly like the Supabase CLI.
 * 3. Gives the local `app_server` role a local-only password.
 * 4. Rebuilds the `<db>_template` database used by parallel DB tests when any migration or the
 *    shim changed (scripts/migrate-key.ts), an earlier-dated migration merged later included.
 *
 * Env: ZABOON_DB_PORT (54322), ZABOON_DB_NAME (zaboon). Flags: --no-template
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { templateKey } from './migrate-key'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const PORT = Number(process.env.ZABOON_DB_PORT ?? 54322)
const DB = process.env.ZABOON_DB_NAME ?? 'zaboon'
const TEMPLATE = `${DB}_template`
const withTemplate = !process.argv.includes('--no-template')

const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const SHIM = readFileSync(join(ROOT, 'supabase', 'local', 'shim.sql'), 'utf8')

type Migration = { version: string; name: string; sql: string }

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const [version, ...rest] = file.replace(/\.sql$/, '').split('_')
      return {
        version: version!,
        name: rest.join('_'),
        sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
      }
    })
}

function connect(user: string, database: string) {
  return postgres({ host: HOST, port: PORT, user, database, max: 1, onnotice: () => {} })
}

async function applyAll(database: string, migrations: Migration[]): Promise<number> {
  const admin = connect('supabase_admin', database)
  try {
    await admin.unsafe(SHIM)
  } finally {
    await admin.end()
  }

  const sql = connect('postgres', database)
  let applied = 0
  try {
    const done = new Set(
      (await sql`SELECT version FROM supabase_migrations.schema_migrations`).map(
        (r) => r.version as string,
      ),
    )
    for (const m of migrations) {
      if (done.has(m.version)) continue
      await sql.begin(async (tx) => {
        await tx.unsafe(m.sql)
        await tx`INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
                 VALUES (${m.version}, ${m.name}, ${[m.sql]})`
      })
      applied++
      console.info(`[migrate] ${database}: applied ${m.version}_${m.name}`)
    }
  } finally {
    await sql.end()
  }

  const admin2 = connect('supabase_admin', database)
  try {
    // Local-only credentials. Production sets the app_server password out of band (runbook).
    await admin2.unsafe(`DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_server') THEN
        ALTER ROLE app_server WITH LOGIN PASSWORD 'app_server_local'; -- pragma: allowlist secret
      END IF;
    END $$;`)
  } finally {
    await admin2.end()
  }
  return applied
}

/** The template refuses connections, so its build key lives in a database comment. */
async function templateVersion(admin: postgres.Sql): Promise<string | null> {
  const rows =
    await admin`SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = ${TEMPLATE}`
  const comment = (rows[0]?.c as string | null) ?? null
  return comment?.startsWith('migrations:') ? comment.slice('migrations:'.length) : null
}

async function rebuildTemplate(migrations: Migration[]) {
  const wanted = templateKey(migrations, SHIM)
  const admin = connect('supabase_admin', 'postgres')
  try {
    const exists = (await admin`SELECT 1 FROM pg_database WHERE datname = ${TEMPLATE}`).length > 0
    if (exists && (await templateVersion(admin)) === wanted) return
    if (exists) {
      await admin.unsafe(`ALTER DATABASE "${TEMPLATE}" IS_TEMPLATE false`)
      await admin.unsafe(`DROP DATABASE "${TEMPLATE}" WITH (FORCE)`)
    }
    await admin.unsafe(`CREATE DATABASE "${TEMPLATE}"`)
  } finally {
    await admin.end()
  }
  await applyAll(TEMPLATE, migrations)
  const admin2 = connect('supabase_admin', 'postgres')
  try {
    await admin2.unsafe(`COMMENT ON DATABASE "${TEMPLATE}" IS 'migrations:${wanted}'`)
    await admin2.unsafe(`ALTER DATABASE "${TEMPLATE}" IS_TEMPLATE true ALLOW_CONNECTIONS false`)
  } finally {
    await admin2.end()
  }
  console.info(`[migrate] rebuilt template database ${TEMPLATE}`)
}

async function main() {
  const migrations = loadMigrations()
  const applied = await applyAll(DB, migrations)
  console.info(`[migrate] ${DB}: ${applied} new migration(s), ${migrations.length} total`)
  if (withTemplate) await rebuildTemplate(migrations)
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
