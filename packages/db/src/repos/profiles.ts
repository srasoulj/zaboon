/** profiles (private), public_profiles (shown to others), settings and consents. */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DEFAULT_SETTINGS, Settings, SettingsPatch } from '@zaboon/contracts'
import type { Tx } from '../index'
import * as schema from '../schema'
import { ConflictError, assertUserId, toIso, toIsoOrNull } from './shared'

export interface Profile {
  userId: string
  timezone: string
  tzChangedAt: string | null
  ageConfirmed: boolean
  onboarded: boolean
  settings: Settings
  createdAt: string
  updatedAt: string
}

export interface PublicProfile {
  userId: string
  username: string | null
  displayName: string | null
  avatar: Record<string, unknown> | null
  streakCurrent: number
  xpTotal: number
}

/**
 * Reads stored settings JSON leniently: every valid key is kept, anything missing or invalid falls
 * back to DEFAULT_SETTINGS, so an old or partial row never breaks a read.
 */
export function parseStoredSettings(stored: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const shape: Record<string, { safeParse(v: unknown): { success: boolean } }> = Settings.shape
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      const field = shape[key]
      if (field && field.safeParse(value).success) out[key] = value
    }
  }
  return out as Settings
}

type ProfileRow = typeof schema.profiles.$inferSelect

function toProfile(row: ProfileRow): Profile {
  return {
    userId: row.userId,
    timezone: row.timezone,
    tzChangedAt: toIsoOrNull(row.tzChangedAt),
    ageConfirmed: row.ageConfirmed,
    onboarded: row.onboarded,
    settings: parseStoredSettings(row.settings),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

function toPublicProfile(row: typeof schema.publicProfiles.$inferSelect): PublicProfile {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatar: (row.avatar as Record<string, unknown> | null) ?? null,
    streakCurrent: row.streakCurrent,
    xpTotal: row.xpTotal,
  }
}

/**
 * Creates the profile rows if missing. The auth.users trigger normally does this already; calling it
 * again is harmless (ON CONFLICT DO NOTHING).
 */
export async function ensureProfile(tx: Tx, userId: string): Promise<void> {
  assertUserId(userId)
  await tx.insert(schema.profiles).values({ userId }).onConflictDoNothing()
  await tx.insert(schema.publicProfiles).values({ userId }).onConflictDoNothing()
}

export async function getProfile(tx: Tx, userId: string): Promise<Profile | null> {
  const [row] = await tx.select().from(schema.profiles).where(eq(schema.profiles.userId, userId))
  return row ? toProfile(row) : null
}

export interface ProfileUpdate {
  timezone?: string
  tzChangedAt?: string | null
  ageConfirmed?: boolean
  onboarded?: boolean
}

export async function updateProfile(tx: Tx, userId: string, patch: ProfileUpdate): Promise<Profile | null> {
  const [row] = await tx
    .update(schema.profiles)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.profiles.userId, userId))
    .returning()
  return row ? toProfile(row) : null
}

/** The learner's settings, with defaults filled in. Returns defaults when the profile is missing. */
export async function getSettings(tx: Tx, userId: string): Promise<Settings> {
  const [row] = await tx
    .select({ settings: schema.profiles.settings })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
  return parseStoredSettings(row?.settings)
}

/** Validates and merges a settings patch into the stored JSON; returns the full settings. */
export async function updateSettings(
  tx: Tx,
  userId: string,
  patch: Partial<Settings>,
): Promise<Settings | null> {
  const valid = SettingsPatch.parse(patch)
  const [row] = await tx
    .update(schema.profiles)
    .set({
      settings: sql`${schema.profiles.settings} || ${JSON.stringify(valid)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.profiles.userId, userId))
    .returning({ settings: schema.profiles.settings })
  return row ? parseStoredSettings(row.settings) : null
}

export async function getPublicProfile(tx: Tx, userId: string): Promise<PublicProfile | null> {
  const [row] = await tx.select().from(schema.publicProfiles).where(eq(schema.publicProfiles.userId, userId))
  return row ? toPublicProfile(row) : null
}

/** Public profile fields of several users (leaderboards). public_profiles are readable by design. */
export async function listPublicProfiles(tx: Tx, userIds: readonly string[]): Promise<PublicProfile[]> {
  if (userIds.length === 0) return []
  const rows = await tx
    .select()
    .from(schema.publicProfiles)
    .where(inArray(schema.publicProfiles.userId, [...userIds]))
  return rows.map(toPublicProfile)
}

export interface PublicProfileUpdate {
  username?: string
  displayName?: string
  avatar?: Record<string, unknown>
}

/** Updates user-editable public fields. Throws ConflictError when the username is taken. */
export async function updatePublicProfile(
  tx: Tx,
  userId: string,
  patch: PublicProfileUpdate,
): Promise<PublicProfile | null> {
  if (patch.username !== undefined) {
    // Checked first because a unique violation would abort the caller's whole transaction.
    // public_profiles are readable by any app_server transaction, so this sees other users' names.
    const [taken] = await tx
      .select({ userId: schema.publicProfiles.userId })
      .from(schema.publicProfiles)
      .where(and(eq(schema.publicProfiles.username, patch.username), sql`${schema.publicProfiles.userId} <> ${userId}`))
    if (taken) throw new ConflictError('username is taken')
  }
  const [row] = await tx
    .update(schema.publicProfiles)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(schema.publicProfiles.userId, userId))
    .returning()
  return row ? toPublicProfile(row) : null
}

/** Denormalized stats shown to other users; written at session commit. */
export async function syncPublicStats(
  tx: Tx,
  userId: string,
  stats: { streakCurrent?: number; xpTotal?: number },
): Promise<void> {
  if (stats.streakCurrent === undefined && stats.xpTotal === undefined) return
  await tx
    .update(schema.publicProfiles)
    .set({ ...stats, updatedAt: sql`now()` })
    .where(eq(schema.publicProfiles.userId, userId))
}

// ---------------------------------------------------------------------------------------------
// Consents (EU analytics)
// ---------------------------------------------------------------------------------------------
export type ConsentKind = 'analytics' | 'marketing'

export async function getConsents(tx: Tx, userId: string): Promise<Partial<Record<ConsentKind, boolean>>> {
  const rows = await tx.select().from(schema.consents).where(eq(schema.consents.userId, userId))
  return Object.fromEntries(rows.map((r) => [r.kind, r.granted]))
}

export async function setConsent(tx: Tx, userId: string, kind: ConsentKind, granted: boolean): Promise<void> {
  await tx
    .insert(schema.consents)
    .values({ userId, kind, granted })
    .onConflictDoUpdate({
      target: [schema.consents.userId, schema.consents.kind],
      set: { granted, updatedAt: sql`now()` },
    })
}
