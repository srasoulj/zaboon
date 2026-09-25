/**
 * Local auth (AUTH_MODE=local only; ADR 0009): HS256 tokens signed with a secret generated once per
 * machine (.local/dev-auth-secret, git-ignored). Claims mirror Supabase's access tokens.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { jwtVerify, SignJWT } from 'jose'
import { ApiError } from '../errors'
import type { AccessClaims } from './types'

export const LOCAL_ISSUER = 'zaboon-local'
export const LOCAL_AUDIENCE = 'authenticated'
export const LOCAL_TOKEN_TTL_SECONDS = 3600

function repoRoot(): string {
  let dir = resolve(process.cwd())
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)
    if (parent === dir) return resolve(process.cwd())
    dir = parent
  }
  return dir
}

let secret: Uint8Array | undefined

function localSecret(): Uint8Array {
  if (secret) return secret
  const fromEnv = process.env.ZABOON_DEV_AUTH_SECRET
  if (fromEnv) return (secret = new TextEncoder().encode(fromEnv))
  const file = join(repoRoot(), '.local', 'dev-auth-secret')
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    try {
      writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e // another process won the race
    }
  }
  return (secret = new TextEncoder().encode(readFileSync(file, 'utf8').trim()))
}

export interface LocalTokenInput {
  userId: string
  isAnonymous: boolean
  email: string | null
  isAdmin?: boolean
  now?: Date
}

export async function signLocalToken(
  input: LocalTokenInput,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const exp = iat + LOCAL_TOKEN_TTL_SECONDS
  const provider = input.isAnonymous ? 'anonymous' : 'email'
  const accessToken = await new SignJWT({
    email: input.email ?? '',
    phone: '',
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: input.isAnonymous ? 'anonymous' : 'otp', timestamp: iat }],
    session_id: randomUUID(),
    is_anonymous: input.isAnonymous,
    app_metadata: { provider, providers: [provider], ...(input.isAdmin ? { role: 'admin' } : {}) },
    user_metadata: {},
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(LOCAL_ISSUER)
    .setAudience(LOCAL_AUDIENCE)
    .setSubject(input.userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(localSecret())
  return { accessToken, expiresAt: new Date(exp * 1000) }
}

export async function verifyLocalToken(
  token: string,
  opts: { allowExpiredForSeconds?: number } = {},
): Promise<Partial<AccessClaims>> {
  try {
    const { payload } = await jwtVerify(token, localSecret(), {
      issuer: LOCAL_ISSUER,
      audience: LOCAL_AUDIENCE,
      algorithms: ['HS256'],
      ...(opts.allowExpiredForSeconds ? { clockTolerance: opts.allowExpiredForSeconds } : {}),
    })
    return payload as Partial<AccessClaims>
  } catch {
    throw new ApiError('unauthorized', 'invalid or expired token')
  }
}

/** How long an expired local token can still be refreshed (Supabase refresh tokens last longer). */
export const LOCAL_REFRESH_WINDOW_SECONDS = 30 * 24 * 3600
