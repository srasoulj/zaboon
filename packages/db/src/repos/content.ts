/**
 * Shared, non-user data: content_versions (served by GET /api/meta) and app_config (every number
 * the game rules use, plus feature flags). Any scope may read; writes need system scope.
 *
 * app_config layout: one row per top-level AppConfig key (e.g. key 'hearts', value
 * {"max": 5, …}) overriding DEFAULT_APP_CONFIG, plus key 'flags' ({flagName: boolean}) overriding
 * FLAG_DEFAULTS. Overrides deep-merge into the defaults.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { AppConfig, DEFAULT_APP_CONFIG, FLAG_DEFAULTS } from '@zaboon/contracts'
import type { Queryable } from './shared'
import type { Tx } from '../index'
import * as schema from '../schema'
import { assertSystemScope, toIso } from './shared'

export interface ContentVersion {
  courseId: string
  version: number
  bundlePath: string
  minAppVersion: string
  includesDrafts: boolean
  isCurrent: boolean
  publishedAt: string
}

function toVersion(r: typeof schema.contentVersions.$inferSelect): ContentVersion {
  return { ...r, publishedAt: toIso(r.publishedAt) }
}

export async function getCurrentContentVersion(db: Queryable, courseId: string): Promise<ContentVersion | null> {
  const t = schema.contentVersions
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.courseId, courseId), eq(t.isCurrent, true)))
  return row ? toVersion(row) : null
}

export async function getContentVersion(db: Queryable, courseId: string, version: number): Promise<ContentVersion | null> {
  const t = schema.contentVersions
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.courseId, courseId), eq(t.version, version)))
  return row ? toVersion(row) : null
}

export async function listContentVersions(db: Queryable, courseId: string): Promise<ContentVersion[]> {
  const t = schema.contentVersions
  const rows = await db.select().from(t).where(eq(t.courseId, courseId)).orderBy(desc(t.version))
  return rows.map(toVersion)
}

/** Registers a published bundle (not current yet). Idempotent: an existing version is left as is. */
export async function publishContentVersion(
  tx: Tx,
  input: { courseId: string; version: number; bundlePath: string; minAppVersion?: string; includesDrafts?: boolean },
): Promise<void> {
  await assertSystemScope(tx)
  await tx.insert(schema.contentVersions).values(input).onConflictDoNothing()
}

/** Makes `version` the course's current version (exactly one current per course). */
export async function setCurrentContentVersion(tx: Tx, courseId: string, version: number): Promise<boolean> {
  await assertSystemScope(tx)
  const t = schema.contentVersions
  const [exists] = await tx
    .select({ version: t.version })
    .from(t)
    .where(and(eq(t.courseId, courseId), eq(t.version, version)))
  if (!exists) return false
  await tx
    .update(t)
    .set({ isCurrent: false })
    .where(and(eq(t.courseId, courseId), eq(t.isCurrent, true), sql`${t.version} <> ${version}`))
  await tx
    .update(t)
    .set({ isCurrent: true })
    .where(and(eq(t.courseId, courseId), eq(t.version, version)))
  return true
}

// ---------------------------------------------------------------------------------------------
// app_config
// ---------------------------------------------------------------------------------------------
export interface LoadedConfig {
  config: AppConfig
  flags: Record<string, boolean>
  /** Override rows that failed validation and were ignored (the defaults apply for those keys). */
  invalidKeys: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v)
  return out
}

export async function getAppConfigRows(db: Queryable): Promise<Record<string, unknown>> {
  const rows = await db.select().from(schema.appConfig)
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

/**
 * AppConfig and flags with database overrides applied. Each override is validated on its own, so
 * one bad row falls back to its default instead of breaking every request.
 */
export async function loadAppConfig(db: Queryable): Promise<LoadedConfig> {
  const rows = await getAppConfigRows(db)
  const config: Record<string, unknown> = { ...DEFAULT_APP_CONFIG }
  const shape: Record<string, { safeParse(v: unknown): { success: boolean } }> = AppConfig.shape
  const invalidKeys: string[] = []
  let flags: Record<string, boolean> = { ...FLAG_DEFAULTS }

  for (const [key, value] of Object.entries(rows)) {
    if (key === 'flags') {
      if (isPlainObject(value) && Object.values(value).every((v) => typeof v === 'boolean')) {
        flags = { ...flags, ...(value as Record<string, boolean>) }
      } else {
        invalidKeys.push(key)
      }
      continue
    }
    const field = shape[key]
    if (!field) {
      invalidKeys.push(key)
      continue
    }
    const merged = deepMerge(config[key], value)
    if (field.safeParse(merged).success) config[key] = merged
    else invalidKeys.push(key)
  }
  return { config: AppConfig.parse(config), flags, invalidKeys: invalidKeys.sort() }
}

export async function setAppConfig(tx: Tx, key: string, value: unknown): Promise<void> {
  await assertSystemScope(tx)
  await tx
    .insert(schema.appConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appConfig.key, set: { value, updatedAt: sql`now()` } })
}
