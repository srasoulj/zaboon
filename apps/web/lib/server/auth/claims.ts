import { ApiError } from '../errors'
import type { AccessClaims, AuthUser } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Maps verified claims to the caller; rejects tokens that are not signed-in user tokens. */
export function userFromClaims(claims: Partial<AccessClaims>): AuthUser {
  if (
    claims.role !== 'authenticated' ||
    typeof claims.sub !== 'string' ||
    !UUID_RE.test(claims.sub)
  ) {
    throw new ApiError('unauthorized', 'not a user access token')
  }
  return {
    id: claims.sub.toLowerCase(),
    isAnonymous: claims.is_anonymous === true,
    email: typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : null,
    isAdmin: claims.app_metadata?.role === 'admin',
  }
}
