/**
 * Request authentication (orchestrator-owned). `authenticate` returns the caller for a valid
 * `Authorization: Bearer` token, null when there is no token, and throws `unauthorized` otherwise.
 */
import { serverEnv } from '../env'
import { ApiError } from '../errors'
import { userFromClaims } from './claims'
import { verifyLocalToken } from './local'
import { verifySupabaseToken } from './supabase'
import type { AuthUser } from './types'

export type { AuthUser } from './types'

export async function authenticate(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) throw new ApiError('unauthorized', 'malformed Authorization header')
  const env = serverEnv()
  const claims =
    env.authMode === 'local'
      ? await verifyLocalToken(match[1]!)
      : await verifySupabaseToken(match[1]!, env.supabaseUrl!)
  return userFromClaims(claims)
}
