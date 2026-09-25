import { errors } from 'jose'
import type * as Jose from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const jwtVerify = vi.fn()
vi.mock('jose', async (importOriginal) => ({
  ...(await importOriginal<typeof Jose>()),
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: (...args: unknown[]) => jwtVerify(...args),
}))

const { verifySupabaseToken } = await import('./supabase')
const URL_ = 'https://project.supabase.test'

async function codeOf(error: unknown): Promise<string> {
  jwtVerify.mockRejectedValueOnce(error)
  try {
    await verifySupabaseToken('token', URL_)
    return 'resolved'
  } catch (e) {
    return (e as { code: string }).code
  }
}

describe('verifySupabaseToken', () => {
  beforeEach(() => jwtVerify.mockReset())

  it('returns the payload of a valid token', async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { sub: 'u1', role: 'authenticated' } })
    await expect(verifySupabaseToken('token', URL_)).resolves.toEqual({
      sub: 'u1',
      role: 'authenticated',
    })
    expect(jwtVerify.mock.calls[0]![2]).toMatchObject({
      issuer: `${URL_}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256'],
    })
  })

  it('rejects bad tokens as unauthorized', async () => {
    expect(await codeOf(new errors.JWTExpired('expired', {}))).toBe('unauthorized')
    expect(await codeOf(new errors.JWSSignatureVerificationFailed())).toBe('unauthorized')
    expect(await codeOf(new errors.JWKSNoMatchingKey())).toBe('unauthorized')
    expect(await codeOf(new errors.JWTClaimValidationFailed('aud', {}, 'aud'))).toBe('unauthorized')
  })

  it('reports an unreachable or unreadable key set as a retryable internal error', async () => {
    expect(await codeOf(new errors.JWKSTimeout())).toBe('internal')
    expect(await codeOf(new errors.JWKSInvalid())).toBe('internal')
    expect(await codeOf(new TypeError('fetch failed'))).toBe('internal')
  })
})
