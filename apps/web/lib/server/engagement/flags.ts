/** Which P2 engagement features a request has on (ctx.flags). Every one is off by default. */
import { ApiError } from '../errors'

export type Flags = Readonly<Record<string, boolean>>

export interface EngagementFlags {
  leagues: boolean
  quests: boolean
  shop: boolean
  practiceHub: boolean
}

export function engagementFlags(flags: Flags = {}): EngagementFlags {
  return {
    leagues: flags.leagues === true,
    quests: flags.quests === true,
    shop: flags.shop === true,
    practiceHub: flags.practiceHub === true,
  }
}

/** A flagged route answers 404 `not_found` while its feature is off, like a route that doesn't exist. */
export function requireFlag(flags: Flags, name: keyof EngagementFlags): void {
  if (flags[name] !== true) throw new ApiError('not_found', 'not found')
}

/** The coin balance shows (home, lesson result) while the shop or quests are on. */
export function showsCoins(f: EngagementFlags): boolean {
  return f.shop || f.quests
}
