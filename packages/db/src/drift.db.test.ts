/**
 * Drift check (docs/ARCHITECTURE.md §13): the Drizzle schema in schema.ts must describe exactly the
 * tables and columns that the migrations create. The SQL migrations are the source of truth.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import * as schema from './schema'
import { createTestDatabase, type TestDatabase } from './testing'

interface ColumnShape {
  type: string
  notNull: boolean
  primaryKey: boolean
}
type TableShape = Record<string, ColumnShape>

/** Drizzle's SQL type names that differ from format_type()'s spelling. */
function normalizeType(t: string): string {
  return t
    .replace(/^timestamp\((\d)\) with time zone$/, 'timestamp with time zone')
    .replace(/^serial$/, 'integer')
    .replace(/^bigserial$/, 'bigint')
}

function drizzleShapes(): Record<string, TableShape> {
  const out: Record<string, TableShape> = {}
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue
    const cfg = getTableConfig(value)
    const pkCols = new Set(cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)))
    const shape: TableShape = {}
    for (const col of cfg.columns) {
      shape[col.name] = {
        type: normalizeType(col.getSQLType()),
        notNull: col.notNull || col.primary || pkCols.has(col.name),
        primaryKey: col.primary || pkCols.has(col.name),
      }
    }
    out[cfg.name] = shape
  }
  return out
}

let tdb: TestDatabase
let admin: postgres.Sql

beforeAll(async () => {
  tdb = await createTestDatabase()
  admin = postgres(tdb.adminUrl, { max: 1, onnotice: () => {} })
})

afterAll(async () => {
  await admin.end()
  await tdb.drop()
})

async function databaseShapes(): Promise<Record<string, TableShape>> {
  const rows = await admin<
    { table_name: string; column_name: string; is_nullable: 'YES' | 'NO'; sql_type: string; is_pk: boolean }[]
  >`
    SELECT c.table_name, c.column_name, c.is_nullable,
           format_type(a.atttypid, a.atttypmod) AS sql_type,
           EXISTS (
             SELECT 1 FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
             WHERE tc.table_schema = 'public' AND tc.table_name = c.table_name
               AND tc.constraint_type = 'PRIMARY KEY' AND k.column_name = c.column_name
           ) AS is_pk
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    JOIN pg_attribute a
      ON a.attrelid = format('public.%I', c.table_name)::regclass AND a.attname = c.column_name
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position`
  const out: Record<string, TableShape> = {}
  for (const r of rows) {
    const table = (out[r.table_name] ??= {})
    table[r.column_name] = { type: r.sql_type, notNull: r.is_nullable === 'NO', primaryKey: r.is_pk }
  }
  return out
}

describe('Drizzle schema ↔ migrated database', () => {
  it('has the same set of tables', async () => {
    const db = await databaseShapes()
    expect(Object.keys(drizzleShapes()).sort()).toEqual(Object.keys(db).sort())
  })

  it('has the same columns, types, nullability and primary keys in every table', async () => {
    const db = await databaseShapes()
    const dz = drizzleShapes()
    for (const table of Object.keys(db)) {
      expect({ table, columns: dz[table] }).toEqual({ table, columns: db[table] })
    }
  })

  it('covers every table in docs/ARCHITECTURE.md §5', async () => {
    const db = await databaseShapes()
    const expected = [
      // MVP
      'profiles', 'public_profiles', 'consents', 'enrollments', 'level_progress', 'sessions', 'session_events',
      'session_answers', 'daily_activity', 'streaks', 'xp_ledger', 'lives', 'user_items', 'lexeme_memory',
      'letter_memory', 'mistakes', 'content_versions', 'app_config', 'reports', 'item_stats', 'rate_limits',
      // P2
      'wallet', 'coin_ledger', 'league_weeks', 'league_cohorts', 'league_members', 'user_league', 'quest_defs',
      'user_quests', 'entitlements', 'webhook_events', 'push_subscriptions',
    ]
    expect(Object.keys(db).sort()).toEqual([...expected].sort())
  })
})
