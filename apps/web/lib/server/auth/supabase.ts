/**
 * Production auth: Supabase access tokens verified locally against the project's JWKS (ADR 0009).
 * Only asymmetric algorithms, the project's issuer and the `authenticated` audience are accepted.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
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
  } catch {
    throw new ApiError('unauthorized', 'invalid or expired token')
  }
}
