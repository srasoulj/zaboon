/**
 * Production auth: Supabase access tokens verified locally against the project's JWKS (ADR 0009).
 * Only asymmetric algorithms, the project's issuer and the `authenticated` audience are accepted.
 */
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import { ApiError } from '../errors'
import type { AccessClaims } from './types'

const ALGORITHMS = ['ES256', 'RS256']
const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function verifySupabaseToken(
  token: string,
  supabaseUrl: string,
): Promise<Partial<AccessClaims>> {
  const base = supabaseUrl.replace(/\/+$/, '')
  let jwks = jwksByUrl.get(base)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`))
    jwksByUrl.set(base, jwks)
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${base}/auth/v1`,
      audience: 'authenticated',
      algorithms: ALGORITHMS,
    })
    return payload as Partial<AccessClaims>
  } catch (err) {
    // The key set couldn't be fetched or read: that says nothing about the token, so it is a
    // retryable server error, never `unauthorized` (clients treat that as final, e.g. they drop a
    // pending guest merge).
    if (isKeySetUnavailable(err)) {
      // withRoute doesn't log ApiErrors: without this an outage would only show as silent 500s.
      console.error('[auth] the Supabase key set is unavailable', err)
      throw new ApiError('internal', 'auth keys are unavailable')
    }
    throw new ApiError('unauthorized', 'invalid or expired token')
  }
}

/**
 * The key set couldn't be used: a JWKS timeout, an unreadable key set, a non-200 or non-JSON JWKS
 * response (jose throws a bare `JOSEError`, code ERR_JOSE_GENERIC, for those), or a non-JOSE failure
 * (the fetch itself failed). Every problem with the token itself is a JOSEError subclass.
 */
export function isKeySetUnavailable(err: unknown): boolean {
  if (err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid) return true
  if (err instanceof errors.JOSEError) return err.code === 'ERR_JOSE_GENERIC'
  return true
}
