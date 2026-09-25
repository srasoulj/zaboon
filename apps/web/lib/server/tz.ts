/** The learner's timezone: validated, and changed at most once per AppConfig.tz interval (§6). */
import type { AppConfig } from '@zaboon/contracts'
import { repos, type Tx } from '@zaboon/db'
import { acceptTzChange } from '@zaboon/game-rules'
import { ApiError } from './errors'

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * The learner's timezone after (maybe) accepting the browser's one. An invalid IANA name is
 * ignored (the stored timezone stays), so a buggy client can't break sessions.
 */
export async function acceptTz(
  tx: Tx,
  userId: string,
  requested: string,
  now: Date,
  config: AppConfig,
): Promise<string> {
  await repos.profiles.ensureProfile(tx, userId)
  const profile = await repos.profiles.getProfile(tx, userId)
  if (!profile) throw new ApiError('internal', 'profile missing')
  if (!isValidTimeZone(requested)) return profile.timezone
  const tzChangedAt = profile.tzChangedAt ? new Date(profile.tzChangedAt) : null
  const r = acceptTzChange({ tz: profile.timezone, tzChangedAt }, requested, now, config)
  if (r.changed)
    await repos.profiles.updateProfile(tx, userId, {
      timezone: r.tz,
      tzChangedAt: now.toISOString(),
    })
  return r.tz
}
